/**
 * The files in the workspace's settings that hold what the app's windows keep
 * across launches. The main process owns them; a window reads them all once
 * as it loads and writes a key back as it changes.
 *
 * They split by what losing one costs: `layout` is where the person left off,
 * `drafts` and `bookmarks` are things they made, and `view` is how they like
 * things laid out. `drafts` is not a file: its one key, {@link DRAFTS_KEY},
 * is kept as a folder per draft at the workspace root.
 */
export const KEPT_FILES = ["bookmarks", "drafts", "layout", "view"] as const;

/** The key of `drafts` the window's drafts are kept under, the only one it holds. */
export const DRAFTS_KEY = "drafts.v2";

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
