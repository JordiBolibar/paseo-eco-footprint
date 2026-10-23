import type {
  PluginHandlerContext,
  PluginServerContext,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { footprintReportRpc } from "../shared/report";
import { scanClaudeSessions } from "./claude";
import { scanSessions } from "./journals";
import {
  appendLedger,
  ensureDataDir,
  loadOffsets,
  readLedger,
  saveOffsets,
  type LedgerEntry,
} from "./ledger";
import { buildReport, createReportCache, resolveTimezone, type FootprintReport, type ReportCache } from "./report";
import { DEFAULT_SETTINGS, settingsSchema, type EcoSettings } from "./settings";

// Coalesce bursts of finished turns into one journal scan.
const INVALIDATE_DEBOUNCE_MS = 4_000;

type PaseoApi = PluginHandlerContext["paseo"];
type SettingsState = PluginSettingsState<typeof settingsSchema>;

export function createFootprintService(server: PluginServerContext): () => void {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const settings = server.registerSettings({
    id: "eco-footprint",
    scope: "host",
    version: 1,
    schema: settingsSchema,
  });

  let current: EcoSettings = DEFAULT_SETTINGS;
  const applySettings = (state: SettingsState): void => {
    current = state.status === "ready" ? state.values : DEFAULT_SETTINGS;
  };
  void settings.read().then(applySettings, () => {});
  const unsubscribeSettings = settings.subscribe((state) => {
    applySettings(state);
  });

  // Live model per session id, learned from Paseo when a turn ends. Better
  // than meta.json, which most sessions do not fill in.
  const modelOverrides = new Map<string, string>();

  async function rememberAgentModel(agentId: string, paseo: PaseoApi): Promise<void> {
    const result = await paseo.agents.ref(agentId).refresh().catch(() => null);
    const agent = result?.agent ?? null;
    const model = agent?.runtimeInfo?.model;
    if (typeof model !== "string" || model === "") return;
    const sessionIds = [
      agent?.runtimeInfo?.sessionId,
      agent?.persistence?.nativeHandle,
      agent?.persistence?.sessionId,
    ];
    for (const sessionId of sessionIds) {
      if (typeof sessionId === "string" && sessionId !== "") {
        modelOverrides.set(sessionId, model);
      }
    }
  }

  let offsets: Record<string, number> = {};
  // Scans are serialized so two sweeps can never append the same records twice.
  let chain: Promise<void> = Promise.resolve();

  function enqueue(job: () => Promise<void>): Promise<void> {
    chain = chain.then(job, job);
    return chain;
  }

  // Scan the journals for records not in the ledger yet and append them.
  // Only the tail of changed files is read, never old data again. Safe to
  // call inline from a job already on the chain.
  async function runCapture(): Promise<void> {
    const result = await scanSessions({
      offsets,
      defaultModel: current.defaultModel,
      modelOverrides,
    });
    offsets = result.offsets;
    const claude = await scanClaudeSessions({ offsets });
    offsets = claude.offsets;
    const entries: LedgerEntry[] = [
      ...result.sessions.map((session) => ({
        ts: Date.now(),
        model: session.model,
        history: false,
        usage: session.usage,
      })),
      // Claude records carry real timestamps, so they keep their own day.
      ...claude.entries.map((entry) => ({
        ts: entry.ts,
        model: entry.model,
        history: false,
        usage: entry.usage,
      })),
    ];
    if (entries.length > 0) {
      await appendLedger(entries);
    }
    await saveOffsets(offsets);
  }

  function capture(): Promise<void> {
    return enqueue(runCapture);
  }

  // One-time backfill on an empty ledger: parse all journals once and
  // attribute each session's totals to its start date. Marked as estimated
  // history, no daily split.
  async function backfill(): Promise<void> {
    const result = await scanSessions({
      offsets: {},
      defaultModel: current.defaultModel,
      modelOverrides,
    });
    offsets = result.offsets;
    // Sessions with no start time at all are attributed to now instead of
    // dropped, so their usage is still counted once.
    const backfillNow = Date.now();
    const entries: LedgerEntry[] = result.sessions.map((session) => ({
      ts: session.startMs ?? backfillNow,
      model: session.model,
      history: true,
      usage: session.usage,
    }));
    await appendLedger(entries);
    await saveOffsets(offsets);
  }

  const ready = enqueue(async () => {
    await ensureDataDir();
    const ledger = await readLedger();
    if (ledger.length === 0) {
      await backfill();
      return;
    }
    const stored = await loadOffsets();
    if (stored) {
      // Catch up on usage written while the daemon was down. Runs inline:
      // this job is already on the chain, so enqueueing here would wait
      // for itself and never finish.
      offsets = stored;
      await runCapture();
      return;
    }
    // Offsets lost but the ledger has data: skip existing content so nothing
    // is counted twice. Records after the last saved offset are lost.
    const result = await scanSessions({
      offsets: {},
      defaultModel: current.defaultModel,
      modelOverrides,
    });
    // The Claude logs too: without this, their whole history would be
    // appended again on the next capture.
    const claudeSkipped = await scanClaudeSessions({ offsets: {} });
    offsets = { ...result.offsets, ...claudeSkipped.offsets };
    await saveOffsets(offsets);
  });

  const fallback: FootprintReport = buildReport([], DEFAULT_SETTINGS, timezone);
  // One cache per timezone: every viewer groups days where they live.
  const caches = new Map<string, ReportCache>();
  function cacheFor(zone: string): ReportCache {
    let cache = caches.get(zone);
    if (!cache) {
      cache = createReportCache(
        capture,
        async () => {
          await ready;
          return buildReport(await readLedger(), current, zone);
        },
        buildReport([], DEFAULT_SETTINGS, zone),
      );
      caches.set(zone, cache);
    }
    return cache;
  }

  server.handle(footprintReportRpc, (input) =>
    cacheFor(resolveTimezone(input.timezone, timezone)).read(),
  );

  let debounce: ReturnType<typeof setTimeout> | null = null;
  server.on("agent.turn_ended", (event, context) => {
    // Remember the model the agent ran, for its session's journal.
    void rememberAgentModel(event.agent.id, context.paseo).catch(() => {});
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      for (const cache of caches.values()) cache.invalidate();
    }, INVALIDATE_DEBOUNCE_MS);
  });

  return () => {
    if (debounce) clearTimeout(debounce);
    unsubscribeSettings();
  };
}
