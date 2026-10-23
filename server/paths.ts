import { homedir } from "node:os";
import { join } from "node:path";

/** Vibe session journals, one directory per session (plus `child-*` dirs). */
export const SESSIONS_DIR = join(homedir(), ".vibe", "logs", "session", "unified");

/** Claude Code session logs, one `.jsonl` file per session under a project dir. */
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** The plugin's own persistent data. */
export const DATA_DIR = join(homedir(), ".paseo", "plugin-data", "eco-footprint");

/** Append-only usage ledger, one JSON object per line. */
export const LEDGER_FILE = join(DATA_DIR, "ledger.jsonl");

/** Byte offset per journal file, so old data is never re-parsed. */
export const OFFSETS_FILE = join(DATA_DIR, "offsets.json");
