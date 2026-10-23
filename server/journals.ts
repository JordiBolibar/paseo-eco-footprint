import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SESSIONS_DIR } from "./paths";

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SessionUsage {
  /** Session directory name under the unified logs root. */
  sessionId: string;
  /** Vibe model name, or the default model when the session records none. */
  model: string;
  usage: UsageTotals;
  /** Session start from meta.json, or the earliest journal file mtime. */
  startMs: number | null;
}

export interface ScanResult {
  /** Sessions with new usage records, one entry per session and model. */
  sessions: SessionUsage[];
  /** Byte offsets after this scan, to persist and pass to the next scan. */
  offsets: Record<string, number>;
}

export interface ScanOptions {
  /** Byte offset per journal file path, from the previous scan. */
  offsets: Record<string, number>;
  /** Model for sessions that do not record one. */
  defaultModel: string;
  /** Live model per session id, learned from Paseo on turn_ended. */
  modelOverrides?: ReadonlyMap<string, string>;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addUsage(target: UsageTotals, add: UsageTotals): void {
  target.inputTokens += add.inputTokens;
  target.cachedInputTokens += add.cachedInputTokens;
  target.outputTokens += add.outputTokens;
  target.totalTokens += add.totalTokens;
}

export function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Read files in chunks instead of one buffer: Claude Code session logs can
// be hundreds of megabytes.
const CHUNK_BYTES = 4 * 1024 * 1024;

// Extract the token usage of one journal record, or null for any other record.
// Every line is parsed as JSON: the same strings also appear inside stored
// tool outputs, so a text search would double-count.
function usageOfRecord(record: unknown): UsageTotals | null {
  if (typeof record !== "object" || record === null) return null;
  const payload = (record as { payload?: unknown }).payload;
  if (typeof payload !== "object" || payload === null) return null;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const outer = result as { type?: unknown; result?: unknown };
  if (outer.type !== "completion_succeeded") return null;
  if (typeof outer.result !== "object" || outer.result === null) return null;
  const usage = (outer.result as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const fields = usage as Record<string, unknown>;
  return {
    inputTokens: numberOrZero(fields.input_tokens),
    cachedInputTokens: numberOrZero(fields.cached_input_tokens),
    outputTokens: numberOrZero(fields.output_tokens),
    totalTokens: numberOrZero(fields.total_tokens),
  };
}

// Read the file from `offset` and pass every complete new line to `onLine`
// as it is read, so huge files never sit in memory as a whole. Returns the
// byte offset after the complete lines. An incomplete last line stays
// unread, so a record written while we read is picked up on the next scan.
// Newlines are split at the byte level, which is safe in UTF-8: no
// multi-byte sequence contains 0x0A.
export async function readNewLinesStream(
  path: string,
  offset: number,
  onLine: (line: string) => void,
): Promise<number> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    if (size === offset) return offset;
    // A file smaller than the offset was replaced: read it from the start.
    const start = offset >= 0 && offset < size ? offset : 0;
    let pending = Buffer.alloc(0);
    let position = start;
    while (position < size) {
      const want = Math.min(CHUNK_BYTES, size - position);
      const buffer = Buffer.alloc(want);
      // A read can return fewer bytes than asked for: only consume what
      // came back, and stop on zero so the loop cannot spin forever.
      const { bytesRead } = await handle.read(buffer, 0, want, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
      let newlineAt = pending.indexOf(0x0a);
      while (newlineAt !== -1) {
        if (newlineAt > 0) onLine(pending.subarray(0, newlineAt).toString("utf8"));
        pending = pending.subarray(newlineAt + 1);
        newlineAt = pending.indexOf(0x0a);
      }
    }
    // Bytes after the last newline are the incomplete tail: not consumed.
    return position - pending.length;
  } finally {
    await handle.close();
  }
}

// Read the file from `offset` and return its complete new lines plus the
// byte offset after them. For files small enough to hold in memory.
export async function readNewLines(
  path: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  const lines: string[] = [];
  const nextOffset = await readNewLinesStream(path, offset, (line) => lines.push(line));
  return { lines, nextOffset };
}

interface SessionMeta {
  model: string | null;
  startMs: number | null;
}

async function readSessionMeta(sessionDir: string): Promise<SessionMeta> {
  try {
    const raw = await readFile(join(sessionDir, "meta.json"), "utf8");
    const meta = JSON.parse(raw) as {
      start_time?: unknown;
      config?: { active_model?: unknown } | null;
    };
    const startMs =
      typeof meta.start_time === "string" ? Date.parse(meta.start_time) : NaN;
    return {
      model:
        typeof meta.config?.active_model === "string"
          ? meta.config.active_model
          : null,
      startMs: Number.isFinite(startMs) ? startMs : null,
    };
  } catch {
    // No meta.json (child sessions) or unreadable: no model, no start time.
    return { model: null, startMs: null };
  }
}

/** Scan every session journal for usage records not read yet. */
export async function scanSessions(options: ScanOptions): Promise<ScanResult> {
  // Start from the previous offsets so a failed read of one file keeps its
  // old offset instead of re-reading that file from the start.
  const offsets: Record<string, number> = { ...options.offsets };
  const sessions = new Map<string, SessionUsage>();
  let dirNames: string[] = [];
  try {
    dirNames = await readdir(SESSIONS_DIR);
  } catch {
    // A failed scan keeps the previous offsets, so nothing is re-read.
    return { sessions: [], offsets: options.offsets };
  }
  for (const dirName of dirNames) {
    const sessionDir = join(SESSIONS_DIR, dirName);
    const journalDir = join(sessionDir, "journal");
    let fileNames: string[] = [];
    try {
      fileNames = await readdir(journalDir);
    } catch {
      continue;
    }
    const meta = await readSessionMeta(sessionDir);
    const model =
      options.modelOverrides?.get(dirName) ?? meta.model ?? options.defaultModel;
    let usage: UsageTotals | null = null;
    // Session start fallback: the earliest journal file mtime.
    let earliestMs: number | null = meta.startMs;
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".jsonl")) continue;
      const path = join(journalDir, fileName);
      let mtimeMs: number | null = null;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        continue;
      }
      if (mtimeMs !== null && (earliestMs === null || mtimeMs < earliestMs)) {
        earliestMs = mtimeMs;
      }
      let read: { lines: string[]; nextOffset: number };
      try {
        read = await readNewLines(path, options.offsets[path] ?? 0);
      } catch {
        continue;
      }
      offsets[path] = read.nextOffset;
      for (const line of read.lines) {
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        const found = usageOfRecord(record);
        if (!found) continue;
        usage ??= emptyUsage();
        addUsage(usage, found);
      }
    }
    if (usage) {
      sessions.set(`${dirName}\u0000${model}`, {
        sessionId: dirName,
        model,
        usage,
        startMs: earliestMs,
      });
    }
  }
  return { sessions: [...sessions.values()], offsets };
}
