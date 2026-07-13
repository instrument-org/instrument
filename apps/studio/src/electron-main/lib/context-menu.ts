import { type BrowserWindow, type WebContentsView } from "electron";
import contextMenu from "electron-context-menu";

import { isDeveloperMode } from "../stores/preferences";

/**
 * How "Inspect" opens DevTools:
 * - `default`: docked, Chromium's last-used dock side (the standard action).
 * - `detach`: a separate DevTools window (good for narrow/side surfaces).
 * - `bottom`: docked at the bottom, clear of any draggable top strip that
 *   would otherwise swallow clicks on a docked DevTools toolbar.
 */
type InspectMode = "bottom" | "default" | "detach";

export function createContextMenu({
  inspectMode = "default",
  windowOrWebContentsView,
}: {
  inspectMode?: InspectMode;
  windowOrWebContentsView: BrowserWindow | WebContentsView;
}) {
  // Keep the library's native default template (spellcheck suggestions, Learn
  // Spelling, Look Up, cut/copy/paste, image/link/video actions) and shape it
  // with flags + append/prepend instead of replacing it with a custom `menu`.
  // A full override has to re-implement every default and silently loses native
  // items as the template evolves, which is how right-click spellcheck went
  // missing.
  return contextMenu({
    append: (defaultActions, parameters) => {
      if (!isDeveloperMode()) {
        return [];
      }
      if (inspectMode === "default") {
        return [defaultActions.inspect()];
      }
      return [
        {
          click: () => {
            windowOrWebContentsView.webContents?.openDevTools({
              mode: inspectMode,
            });
            windowOrWebContentsView.webContents?.inspectElement(
              parameters.x,
              parameters.y,
            );
          },
          label:
            inspectMode === "detach"
              ? "Inspect Element in New Window"
              : "Inspect Element",
        },
      ];
    },
    // Offer "Copy Link" for real links only. A `file://` link is a local path an
    // agent emitted in markdown; copying `file:///…` to the clipboard isn't
    // useful.
    prepend: (defaultActions, parameters) =>
      parameters.linkURL && !parameters.linkURL.startsWith("file://")
        ? [defaultActions.copyLink({})]
        : [],
    // Provided via `append` so the developer-mode check runs per right-click.
    showInspectElement: false,
    // Off by default on macOS; kept to match prior behavior.
    showSaveImageAs: true,
    showSaveVideoAs: true,
    // Opening the external browser from a desktop text field is out of place.
    showSearchWithGoogle: false,
    // Off by default on macOS; kept so editable/selection menus still offer it.
    showSelectAll: true,
    window: windowOrWebContentsView,
  });
}
