/**
 * The files that hold what the app's windows keep across launches. The main
 * process owns them; a window reads them all once as it loads and writes a
 * key back as it changes.
 *
 * They split by what losing one costs: `layout` is where the person left off,
 * and `view` is how they like things laid out. Both stay on this computer, in
 * the workspace's machine folder. Drafts are not kept here: main owns them
 * as a folder each in the workspace's `Drafts/` (`shared/drafts.ts`). Nor are
 * bookmarks: they are a synced store every device writes its own file of
 * (`shared/bookmarks.ts`).
 */
export const SHARED_KEPT_FILES = ["layout", "view"] as const;

/**
 * What one window keeps for itself, where the others keep their own: its
 * strip of tabs and what it had up. A key of `layout` and `view` is the same
 * for every window, and each window's write reaches the others; a key of
 * `window` goes with the window it was written in.
 */
export const WINDOW_KEPT_FILE = "window";

const KEPT_FILES = [...SHARED_KEPT_FILES, WINDOW_KEPT_FILE] as const;

export type KeptFile = (typeof KEPT_FILES)[number];

/** The keys an earlier build kept for its one window in `layout`, which the first window takes as its own. */
export const WINDOW_KEPT_KEYS = [
  "app-tabs.v2",
  "chat-group.v2",
  "compose.v2",
  "files-folder.v1",
  "inbox-open.v1",
] as const;

/** Every kept file's keys and values, as a window loads them. */
export type KeptSnapshot = Partial<Record<KeptFile, Record<string, unknown>>>;

export function isKeptFile(file: unknown): file is KeptFile {
  return KEPT_FILES.some((name) => name === file);
}

/**
 * The IPC channels between a window and the kept state: `load` is the
 * preload's synchronous read of every file, `set` a window's write of one key
 * (`undefined` removes it), `changed` the main process telling the other
 * windows about a write, and `otherWindows` a synchronous read of one key of
 * `window` as every other window kept it, closed ones that can come back
 * included.
 */
export const KEPT_STATE_CHANNEL = {
  otherWindows: "kept-state:other-windows",
  changed: "kept-state:changed",
  load: "kept-state:load",
  set: "kept-state:set",
} as const;
