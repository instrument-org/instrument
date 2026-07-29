import { type BrowserWindow, type ContextMenuParams } from "electron";
import contextMenu from "electron-context-menu";

import { isDeveloperMode } from "../stores/preferences";
import { saveContextMenuMediaAs } from "./context-menu-download";

/**
 * How "Inspect" opens DevTools:
 * - `default`: docked, Chromium's last-used dock side (the standard action).
 * - `detach`: a separate DevTools window (good for narrow/side surfaces).
 * - `bottom`: docked at the bottom, clear of any draggable top strip that
 *   would otherwise swallow clicks on a docked DevTools toolbar.
 */
type InspectMode = "bottom" | "default" | "detach";

export function createContextMenu({
  browserWindow,
  inspectMode = "default",
}: {
  browserWindow: BrowserWindow;
  inspectMode?: InspectMode;
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
            browserWindow.webContents.openDevTools({
              mode: inspectMode,
            });
            browserWindow.webContents.inspectElement(
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
    // Offer "Copy Link" for links that lead somewhere outside the app; see
    // `isCopyableLink`.
    prepend: (defaultActions, parameters) => [
      ...(isCopyableLink(parameters) ? [defaultActions.copyLink({})] : []),
      ...getSaveMediaAsItems({ browserWindow, parameters }),
    ],
    // Copy Link is conditional, so suppress the template's unconditional one
    // and supply it from `prepend`.
    showCopyLink: false,
    // Provided via `append` so the developer-mode check runs per right-click.
    showInspectElement: false,
    // The library discards these downloads' promises, but canceling a native
    // save dialog rejects one. `prepend` supplies cancel-aware equivalents.
    showSaveImageAs: false,
    showSaveVideoAs: false,
    // Opening the external browser from a desktop text field is out of place.
    showSearchWithGoogle: false,
    // Off by default on macOS; kept so editable/selection menus still offer it.
    showSelectAll: true,
    window: browserWindow,
  });
}

function getSaveMediaAsItems({
  browserWindow,
  parameters,
}: {
  browserWindow: BrowserWindow;
  parameters: ContextMenuParams;
}) {
  if (parameters.mediaType !== "image" && parameters.mediaType !== "video") {
    return [];
  }
  return [
    {
      click: () => {
        void saveContextMenuMediaAs({
          browserWindow,
          url: parameters.srcURL,
        });
      },
      label:
        parameters.mediaType === "image" ? "Save Image As…" : "Save Video As…",
    },
  ];
}

/**
 * Whether a link's URL is worth putting on the clipboard. Two kinds aren't:
 * a `file://` link is a local path an agent emitted in markdown, and a link to
 * an in-app route is a bare pathname the browser resolves against the renderer
 * document, so it comes back as a dev-server URL or a nonexistent
 * `file:///skills/foo`. Both share the page's origin; anything genuinely
 * external doesn't.
 */
function isCopyableLink({
  linkURL,
  pageURL,
}: {
  linkURL: string;
  pageURL: string;
}) {
  if (!linkURL || linkURL.startsWith("file://")) {
    return false;
  }
  try {
    return new URL(linkURL).origin !== new URL(pageURL).origin;
  } catch {
    return false;
  }
}
