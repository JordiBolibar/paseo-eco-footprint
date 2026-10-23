import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_PROJECTS_DIR } from "./paths";
import {
  addUsage,
  emptyUsage,
  numberOrZero,
  readNewLinesStream,
  type UsageTotals,
} from "./journals";

export interface ClaudeUsage {
  /** Model name as recorded by Claude Code (e.g. "claude-sonnet-5-5"). */
  model: string;
  /** Timestamp of the latest record in the group, in epoch milliseconds. */
  ts: number;
  usage: UsageTotals;
}

export interface ClaudeScanResult {
  /** New usage since the last scan, one entry per session file, model and
   * quarter hour. */
  entries: ClaudeUsage[];
  /** Byte offsets after this scan, to persist and pass to the next scan. */
  offsets: Record<string, number>;
}

export interface ClaudeScanOptions {
  /** Byte offset per log file path, from the previous scan. */
  offsets: Record<string, number>;
}

// Extract the token usage of one Claude Code log record, or null for any
// other record. Assistant records carry the model name and the usage of one
// API call, plus the timestamp of when it happened. Records that are not real
// API calls (local error messages, "<synthetic>" models) are filtered out by
// the model check and the zero-output check below.
function usageOfRecord(record: unknown): {
  id: string | null;
  model: string;
  ts: number;
  usage: UsageTotals;
} | null {
  if (typeof record !== "object" || record === null) return null;
  const outer = record as { type?: unknown; timestamp?: unknown; message?: unknown };
  if (outer.type !== "assistant") return null;
  if (typeof outer.message !== "object" || outer.message === null) return null;
  const message = outer.message as { id?: unknown; model?: unknown; usage?: unknown };
  const model = message.model;
  if (typeof model !== "string" || !model.startsWith("claude")) return null;
  const ts = typeof outer.timestamp === "string" ? Date.parse(outer.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  if (typeof message.usage !== "object" || message.usage === null) return null;
  const fields = message.usage as Record<string, unknown>;
  const outputTokens = numberOrZero(fields.output_tokens);
  if (outputTokens <= 0) return null;
  const inputTokens = numberOrZero(fields.input_tokens);
  const cacheCreation = numberOrZero(fields.cache_creation_input_tokens);
  const cacheRead = numberOrZero(fields.cache_read_input_tokens);
  return {
    id: typeof message.id === "string" ? message.id : null,
    model,
    ts,
    usage: {
      inputTokens,
      cachedInputTokens: cacheRead,
      outputTokens,
      totalTokens: inputTokens + outputTokens + cacheCreation + cacheRead,
    },
  };
}

// Claude Code writes the same assistant message several times into a log
// file, and copies old messages into the new file when a session is resumed.
// Count each message once, across all files. The set lives for the lifetime
// of the plugin: a duplicate pair that straddles a daemon restart can slip
// through, which is rare and small.
const seenMessageIds = new Set<string>();

/** Scan every Claude Code session log for usage records not read yet. Unlike
 * Vibe journals, the records carry real timestamps, so each day's usage is
 * attributed to the day it happened, even on the first full read. */
export async function scanClaudeSessions(options: ClaudeScanOptions): Promise<ClaudeScanResult> {
  // Start from the previous offsets so a failed read of one file keeps its
  // old offset instead of re-reading that file from the start.
  const offsets: Record<string, number> = { ...options.offsets };
  const groups = new Map<string, ClaudeUsage>();
  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(CLAUDE_PROJECTS_DIR);
  } catch {
    // No Claude Code logs at all, or unreadable: nothing to add.
    return { entries: [], offsets: options.offsets };
  }
  for (const projectDir of projectDirs) {
    let fileNames: string[] = [];
    try {
      fileNames = await readdir(join(CLAUDE_PROJECTS_DIR, projectDir));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".jsonl")) continue;
      const path = join(CLAUDE_PROJECTS_DIR, projectDir, fileName);
      // Lines are handled as they are read: one log file can be hundreds of
      // megabytes, and only the small per-quarter-hour groups are kept in
      // memory.
      const handleLine = (line: string): void => {
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          return;
        }
        const found = usageOfRecord(record);
        if (!found) return;
        // A repeated message id is the same API call logged again, in this
        // file or in a resumed copy of the session: skip it.
        if (found.id !== null) {
          if (seenMessageIds.has(found.id)) return;
          seenMessageIds.add(found.id);
        }
        // One group per session file, model and quarter hour. Every real
        // timezone offset is a multiple of 15 minutes, so the report can
        // bucket each group into the viewer's local day exactly.
        const quarter = new Date(found.ts).toISOString().slice(0, 16);
        const key = `${path}\u0000${found.model}\u0000${quarter}`;
        let group = groups.get(key);
        if (!group) {
          group = { model: found.model, ts: found.ts, usage: emptyUsage() };
          groups.set(key, group);
        }
        addUsage(group.usage, found.usage);
        if (found.ts > group.ts) group.ts = found.ts;
      };
      try {
        offsets[path] = await readNewLinesStream(path, options.offsets[path] ?? 0, handleLine);
      } catch {
        continue;
      }
    }
  }
  return { entries: [...groups.values()], offsets };
}
