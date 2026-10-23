import type { RpcOutput } from "@getpaseo/plugin";
import { footprintReportRpc } from "../shared/report";
import { computeModelImpacts, resolveZone, zoneIsProviderDefault } from "./ecologits";
import { addUsage, emptyUsage, type UsageTotals } from "./journals";
import type { LedgerEntry } from "./ledger";
import type { EcoSettings } from "./settings";

export type FootprintReport = RpcOutput<typeof footprintReportRpc>;

const DAY_MS = 86_400_000;
const SERIES_LENGTH = { daily: 30, weekly: 12, monthly: 12 } as const;

// A report older than this is served once more while a fresh one loads.
const FRESH_MS = 60_000;

// Calendar keys are handled as UTC midnights so arithmetic never crosses a
// DST change. (Same approach as the ccusage-stats plugin.)
function keyMs(key: string): number {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function msDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Local calendar day of a timestamp in the daemon's timezone (en-CA: YYYY-MM-DD).
function localDayKey(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

export function localToday(timezone: string): string {
  return localDayKey(Date.now(), timezone);
}

/** The requested timezone when valid, else the daemon's own. */
export function resolveTimezone(requested: string, fallback: string): string {
  const zone = requested.trim();
  if (zone === "") return fallback;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone;
  } catch {
    return fallback;
  }
}

/** The last `count` day keys ending at `today`, oldest first. */
function dayKeys(today: string, count: number): string[] {
  const todayMs = keyMs(today);
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    keys.push(msDayKey(todayMs - back * DAY_MS));
  }
  return keys;
}

/** The last `count` Monday keys, ending in the current week, oldest first. */
function weekKeys(today: string, count: number): string[] {
  const todayMs = keyMs(today);
  const mondayMs = todayMs - ((new Date(todayMs).getUTCDay() + 6) % 7) * DAY_MS;
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    keys.push(msDayKey(mondayMs - back * 7 * DAY_MS));
  }
  return keys;
}

/** The last `count` month keys ("YYYY-MM"), oldest first. */
function monthKeys(today: string, count: number): string[] {
  const date = new Date(keyMs(today));
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1));
    keys.push(month.toISOString().slice(0, 7));
  }
  return keys;
}

/** Token sums per model. */
type ModelMap = Map<string, UsageTotals>;

function mergeModels(byDay: Map<string, ModelMap>, days: readonly string[]): ModelMap {
  const merged: ModelMap = new Map();
  for (const day of days) {
    const models = byDay.get(day);
    if (!models) continue;
    for (const [model, usage] of models) {
      let target = merged.get(model);
      if (!target) {
        target = emptyUsage();
        merged.set(model, target);
      }
      addUsage(target, usage);
    }
  }
  return merged;
}

function periodOf(
  period: string,
  models: ModelMap,
  settings: EcoSettings,
  zone: string,
): FootprintReport["daily"][number] {
  const perModel = [...models.entries()]
    .map(([model, usage]) => {
      const impacts = computeModelImpacts(model, usage.outputTokens, settings, zone);
      return {
        model,
        estimated: impacts.estimated,
        impacts: {
          usage: { ...usage },
          energyWh: impacts.energyWh,
          gwpGco2eq: impacts.gwpGco2eq,
          gwpEmbodiedGco2eq: impacts.gwpEmbodiedGco2eq,
        },
      };
    })
    .sort((a, b) => b.impacts.energyWh - a.impacts.energyWh || a.model.localeCompare(b.model));
  const totals = {
    usage: emptyUsage(),
    energyWh: 0,
    gwpGco2eq: 0,
    gwpEmbodiedGco2eq: 0,
  };
  for (const entry of perModel) {
    addUsage(totals.usage, entry.impacts.usage);
    totals.energyWh += entry.impacts.energyWh;
    totals.gwpGco2eq += entry.impacts.gwpGco2eq;
    totals.gwpEmbodiedGco2eq += entry.impacts.gwpEmbodiedGco2eq;
  }
  return { period, impacts: totals, models: perModel };
}

export function buildReport(
  entries: LedgerEntry[],
  settings: EcoSettings,
  timezone: string,
): FootprintReport {
  const today = localToday(timezone);
  const months = monthKeys(today, SERIES_LENGTH.monthly);
  // The monthly series is the widest window; usage outside it is not shown.
  const oldestMs = keyMs(`${months[0]}-01`);
  const zone = resolveZone(settings.electricityMixZone);

  // Token sums per local day and model.
  const byDay = new Map<string, ModelMap>();
  let historyEstimated = false;
  for (const entry of entries) {
    if (entry.ts < oldestMs) continue;
    const day = localDayKey(entry.ts, timezone);
    let models = byDay.get(day);
    if (!models) {
      models = new Map();
      byDay.set(day, models);
    }
    let usage = models.get(entry.model);
    if (!usage) {
      usage = emptyUsage();
      models.set(entry.model, usage);
    }
    addUsage(usage, entry.usage);
    if (entry.history) historyEstimated = true;
  }

  const daily = dayKeys(today, SERIES_LENGTH.daily).map((day) =>
    periodOf(day, mergeModels(byDay, [day]), settings, zone),
  );
  const weekly = weekKeys(today, SERIES_LENGTH.weekly).map((monday) =>
    periodOf(
      monday,
      mergeModels(
        byDay,
        Array.from({ length: 7 }, (_, i) => msDayKey(keyMs(monday) + i * DAY_MS)),
      ),
      settings,
      zone,
    ),
  );
  const monthly = months.map((month) =>
    periodOf(
      month,
      mergeModels(
        byDay,
        [...byDay.keys()].filter((day) => day.startsWith(`${month}-`)),
      ),
      settings,
      zone,
    ),
  );

  // Every model seen in the report, heaviest first: a stable order for colors.
  const allModels = mergeModels(byDay, [...byDay.keys()]);
  const modelNames = [...allModels.entries()]
    .map(([model, usage]) => ({
      model,
      energyWh: computeModelImpacts(model, usage.outputTokens, settings, zone).energyWh,
    }))
    .sort((a, b) => b.energyWh - a.energyWh || a.model.localeCompare(b.model))
    .map((entry) => entry.model);

  return {
    generatedAt: Date.now(),
    today,
    timezone,
    zone,
    zoneIsDefault: zoneIsProviderDefault(settings.electricityMixZone),
    defaultModel: settings.defaultModel,
    models: modelNames,
    daily,
    weekly,
    monthly,
    historyEstimated,
    refreshError: null,
  };
}

export interface ReportCache {
  read(): Promise<FootprintReport>;
  /** Records new usage, then rebuilds the report in the background. */
  invalidate(): void;
}

/**
 * Serves the report with a short cache. `capture` appends new usage to the
 * ledger, `rebuild` reads the ledger and computes the report. When a refresh
 * fails, the last report is served with `refreshError` set.
 */
export function createReportCache(
  capture: () => Promise<void>,
  rebuild: () => Promise<FootprintReport>,
  fallback: FootprintReport,
): ReportCache {
  let snapshot: FootprintReport | null = null;
  let fetchedAt = 0;
  // Bumped by every invalidation; a run that started before the last bump is
  // already stale.
  let invalidations = 0;
  let freshAs = 0;
  let refreshError: string | null = null;
  let inflight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    inflight ??= (async () => {
      const startedAt = Date.now();
      const seen = invalidations;
      try {
        await capture();
        const next = await rebuild();
        snapshot = next;
        fetchedAt = startedAt;
        freshAs = seen;
        refreshError = null;
      } catch (error) {
        refreshError = (error as Error).message;
        console.error(`[eco-footprint] ${refreshError}`);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    async read() {
      if (!snapshot) {
        await refresh();
        return snapshot ?? { ...fallback, refreshError };
      }
      if (freshAs !== invalidations || Date.now() - fetchedAt > FRESH_MS) {
        void refresh();
      }
      return { ...snapshot, refreshError };
    },
    invalidate() {
      invalidations += 1;
      void refresh();
    },
  };
}
