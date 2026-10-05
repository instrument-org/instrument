/**
 * What the app's windows keep across launches, each key with the file in the
 * workspace's settings it is kept in. The main process owns the files; a
 * window reads them all once as it loads and writes a key back as it changes.
 *
 * The files split by what losing one costs: `layout` is where the person left
 * off, `drafts` and `bookmarks` are things they made, `history` is what they
 * visited, and `view` is how they like things laid out. A key's version is
 * what lets its value's meaning change later: bumping it makes an old value
 * ignored rather than read as something it is not.
 */
export const KEPT_STATE_FILES = {
  "app-tabs.v2": "layout",
  "bookmarks.v1": "bookmarks",
  "chat-group.v2": "layout",
  "compose.v2": "layout",
  "computer-column-width.v1": "view",
  "computer-folder-views.v1": "view",
  "computer-hidden-files.v1": "view",
  "computer-list-column-widths.v1": "view",
  "computer-list-columns.v1": "view",
  "computer-sort.v1": "view",
  "computer-view.v1": "view",
  "drafts.v2": "drafts",
  "file-tree-open.v1": "view",
  "file-tree-width.v1": "view",
  "file-viewer-wrap-lines.v1": "view",
  "finder-places-open.v1": "view",
  "finder-places-width.v1": "view",
  "inbox-open.v1": "layout",
  "inbox-width.v1": "view",
  "pane-open.v2": "layout",
  "pane-share.v1": "view",
  "recents.v4": "history",
  "visited-pages.v1": "history",
  "window-tabs.v9": "layout",
  "zoom.v1": "view",
} as const;

export type KeptKey = keyof typeof KEPT_STATE_FILES;

export type KeptFile = (typeof KEPT_STATE_FILES)[KeptKey];

export function isKeptKey(key: unknown): key is KeptKey {
  return typeof key === "string" && Object.hasOwn(KEPT_STATE_FILES, key);
}

/**
 * The IPC channels between a window and the kept state: `load` is the
 * preload's synchronous read of every key, `set` a window's write of one
 * (`undefined` removes it), and `changed` the main process telling the other
 * windows about a write.
 */
export const KEPT_STATE_CHANNEL = {
  changed: "kept-state:changed",
  load: "kept-state:load",
  set: "kept-state:set",
} as const;
