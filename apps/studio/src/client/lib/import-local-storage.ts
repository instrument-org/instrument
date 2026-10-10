import { type KeptFile } from "@/shared/kept-state";

import { hasKept, writeKept } from "./kept-state";

/**
 * Beta-only: 2.0 betas kept the window's state in localStorage, each key
 * under `studio.`. Delete this file and its call in `main.tsx` once every
 * beta install has launched a build that kept state in files.
 *
 * Each key here, and the file it moves to under the same name less `studio.`.
 */
const LEGACY_KEYS: Record<string, KeptFile> = {
  "studio.app-tabs.v2": "layout",
  "studio.bookmarks.v1": "bookmarks",
  "studio.chat-group.v2": "layout",
  "studio.compose.v2": "layout",
  "studio.computer-column-width.v1": "view",
  "studio.computer-folder-views.v1": "view",
  "studio.computer-hidden-files.v1": "view",
  "studio.computer-list-column-widths.v1": "view",
  "studio.computer-list-columns.v1": "view",
  "studio.computer-sort.v1": "view",
  "studio.computer-view.v1": "view",
  "studio.drafts.v2": "drafts",
  "studio.file-tree-open.v1": "view",
  "studio.file-tree-width.v1": "view",
  "studio.file-viewer-wrap-lines.v1": "view",
  "studio.finder-places-open.v1": "view",
  "studio.finder-places-width.v1": "view",
  "studio.inbox-open.v1": "layout",
  "studio.inbox-width.v1": "view",
  "studio.pane-open.v2": "layout",
  "studio.pane-share.v1": "view",
  "studio.recents.v4": "history",
  "studio.window-tabs.v9": "layout",
  "studio.zoom.v1": "view",
};

/**
 * Beta-only: moves what a beta kept in this window's localStorage into the
 * kept files, once. A key a file already has keeps its value, and the old
 * key goes either way. Runs before anything reads a kept atom.
 */
export function importLocalStorage(
  storage: Pick<Storage, "getItem" | "removeItem">,
) {
  for (const [legacy, file] of Object.entries(LEGACY_KEYS)) {
    const raw = storage.getItem(legacy);
    if (raw === null) {
      continue;
    }
    const key = legacy.slice("studio.".length);
    if (!hasKept(file, key)) {
      try {
        const value: unknown = JSON.parse(raw);
        writeKept(file, key, value);
      } catch {
        // Not JSON: nothing to bring over.
      }
    }
    storage.removeItem(legacy);
  }
}
