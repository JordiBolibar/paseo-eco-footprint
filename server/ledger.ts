import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { DATA_DIR, LEDGER_FILE, OFFSETS_FILE } from "./paths";
import type { UsageTotals } from "./journals";

export interface LedgerEntry {
  /** When the usage was recorded. Backfill entries use the session start. */
  ts: number;
  /** Vibe model name, or the default model when the session records none. */
  model: string;
  /** True for backfilled history, which has no daily split. */
  history: boolean;
  usage: UsageTotals;
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function appendLedger(entries: LedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const text = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await appendFile(LEDGER_FILE, text, "utf8");
}

function parseEntry(value: unknown): LedgerEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts)) return null;
  if (typeof entry.model !== "string" || entry.model === "") return null;
  if (typeof entry.history !== "boolean") return null;
  const usage = entry.usage;
  if (typeof usage !== "object" || usage === null) return null;
  const fields = usage as Record<string, unknown>;
  const numbers = [fields.inputTokens, fields.cachedInputTokens, fields.outputTokens, fields.totalTokens];
  if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return {
    ts: entry.ts,
    model: entry.model,
    history: entry.history,
    usage: {
      inputTokens: fields.inputTokens as number,
      cachedInputTokens: fields.cachedInputTokens as number,
      outputTokens: fields.outputTokens as number,
      totalTokens: fields.totalTokens as number,
    },
  };
}

export async function readLedger(): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(LEDGER_FILE, "utf8");
  } catch {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    try {
      const entry = parseEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch {
      // A line cut short by a concurrent append: skipped, not an error.
    }
  }
  return entries;
}

export async function loadOffsets(): Promise<Record<string, number> | null> {
  try {
    const parsed = JSON.parse(await readFile(OFFSETS_FILE, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const offsets: Record<string, number> = {};
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        offsets[path] = value;
      }
    }
    return offsets;
  } catch {
    return null;
  }
}

export async function saveOffsets(offsets: Record<string, number>): Promise<void> {
  const tmp = `${OFFSETS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(offsets), "utf8");
  await rename(tmp, OFFSETS_FILE);
}
