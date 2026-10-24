import { type ChatSource, type ImportSource } from "../model";

/**
 * The coding agents on this computer with chats to import. A placeholder
 * until the parsers land: it finds none.
 */
export function localSources(_homeDir?: string): Promise<ImportSource[]> {
  return Promise.resolve([]);
}

/** One coding agent's chats on this computer. A placeholder until the parsers land. */
export function openLocalSource(
  _kind: "claude-code" | "codex" | "cursor",
  _homeDir?: string,
): ChatSource {
  throw new Error("Importing from a coding agent is not built yet.");
}
