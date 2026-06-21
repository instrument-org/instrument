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
  return contextMenu({
    menu: (defaultActions, parameters) => {
      const menuItems = [];

      const isFileUrl = parameters.linkURL.startsWith("file://");

      if (parameters.linkURL && !isFileUrl) {
        menuItems.push(defaultActions.copyLink({}));
      }

      if (parameters.mediaType === "image") {
        menuItems.push(
          defaultActions.copyImage({}),
          defaultActions.saveImageAs({}),
        );
      }

      if (parameters.mediaType === "video") {
        menuItems.push(defaultActions.saveVideoAs({}));
      }

      if (parameters.isEditable || parameters.selectionText) {
        if (menuItems.length > 0) {
          menuItems.push(defaultActions.separator());
        }
        menuItems.push(
          defaultActions.cut({}),
          defaultActions.copy({}),
          defaultActions.paste({}),
          defaultActions.separator(),
          defaultActions.selectAll({}),
        );
      } else if (
        !parameters.linkURL &&
        parameters.mediaType !== "image" &&
        parameters.mediaType !== "video"
      ) {
        if (menuItems.length > 0) {
          menuItems.push(defaultActions.separator());
        }
        menuItems.push(defaultActions.selectAll({}));
      }

      if (parameters.selectionText && menuItems.length > 0) {
        menuItems.push(defaultActions.separator());
      }

      if (isDeveloperMode()) {
        if (menuItems.length > 0) {
          menuItems.push(defaultActions.separator());
        }

        if (inspectMode === "default") {
          menuItems.push(defaultActions.inspect());
        } else {
          menuItems.push({
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
          });
        }
      }

      return menuItems;
    },
    window: windowOrWebContentsView,
  });
}
