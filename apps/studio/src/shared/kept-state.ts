/**
 * The files in the workspace's settings that hold what the app's windows keep
 * across launches. The main process owns them; a window reads them all once
 * as it loads and writes a key back as it changes.
 *
 * They split by what losing one costs: `layout` is where the person left off,
 * `drafts` and `bookmarks` are things they made, `history` is what they
 * visited, and `view` is how they like things laid out.
 */
export const KEPT_FILES = [
  "bookmarks",
  "drafts",
  "history",
  "layout",
  "view",
] as const;

export type KeptFile = (typeof KEPT_FILES)[number];

/** Every kept file's keys and values, as a window loads them. */
export type KeptSnapshot = Partial<Record<KeptFile, Record<string, unknown>>>;

export function isKeptFile(file: unknown): file is KeptFile {
  return KEPT_FILES.some((name) => name === file);
}

/**
 * The IPC channels between a window and the kept state: `load` is the
 * preload's synchronous read of every file, `set` a window's write of one key
 * (`undefined` removes it), and `changed` the main process telling the other
 * windows about a write.
 */
export const KEPT_STATE_CHANNEL = {
  changed: "kept-state:changed",
  load: "kept-state:load",
  set: "kept-state:set",
} as const;
