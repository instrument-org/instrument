import { openExternal } from "@/electron-main/lib/open-external";
import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import {
  clipboard,
  type ContextMenuParams,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { noop } from "radashi";

import { isFileUrl, isHttpUrl } from "./window-open-policy";

/**
 * Where a link in the guest can go besides the guest itself: a tab of the
 * window's own, for a window that has tabs, and the checks a link must pass
 * to be followed from this page.
 */
export interface GuestLinkPlaces {
  /** Whether this page may send a tab to the address: see `mayPageNavigateTo`. */
  mayOpen: (url: string) => boolean;
  /** Opens the address in a tab of the window's own; absent where the window has none. */
  openInNewTab?: (url: string) => void;
  /** Asks the window to step the tab the page is in, which runs into the page's own history first. */
  step: (direction: "back" | "forward") => void;
}

/** Wire user input the agent-browser guest needs to be usable directly: a
 * right-click context menu. Thumb buttons over the page are the window's: see
 * `handThumbsToWindow` in the page's preload. */
export function attachGuestInteractions(
  guest: WebContents,
  places: GuestLinkPlaces,
) {
  guest.on("context-menu", (_event, params) => {
    Menu.buildFromTemplate(contextMenuTemplate(guest, params, places)).popup();
  });
}

function contextMenuTemplate(
  guest: WebContents,
  params: ContextMenuParams,
  places: GuestLinkPlaces,
): MenuItemConstructorOptions[] {
  const { editFlags } = params;
  const items: MenuItemConstructorOptions[] = [
    {
      click: () => {
        places.step("back");
      },
      enabled: guest.navigationHistory.canGoBack(),
      label: "Back",
    },
    {
      click: () => {
        places.step("forward");
      },
      enabled: guest.navigationHistory.canGoForward(),
      label: "Forward",
    },
    {
      click: () => {
        guest.reload();
      },
      label: "Reload",
    },
    { type: "separator" },
  ];

  if (params.linkURL) {
    const url = params.linkURL;
    // "Open Link" is the manual path for a link the guest would otherwise
    // decline, and the only one for a link that opens no tab at all -- a
    // download target, a form-driven link. Offered only for what the guest
    // can actually navigate to: the web, and a file a local page links to.
    const isOpenable =
      (isHttpUrl(url) || isFileUrl(url)) && places.mayOpen(url);
    if (isOpenable) {
      items.push({
        click: () => {
          void guest.loadURL(url).catch(noop);
        },
        label: "Open Link",
      });
      const { openInNewTab } = places;
      if (openInNewTab) {
        items.push({
          click: () => {
            openInNewTab(url);
          },
          label: "Open Link in New Tab",
        });
      }
    }
    if (isHttpUrl(url)) {
      items.push({
        click: () => {
          void openExternal(url);
        },
        label: "Open Link in Default Browser",
      });
    }
    items.push(
      {
        click: () => {
          void clipboard.writeText(params.linkURL);
        },
        label: "Copy Link",
      },
      { type: "separator" },
    );
  }

  if (params.isEditable || params.selectionText) {
    items.push(
      { enabled: editFlags.canCut, label: "Cut", role: "cut" },
      { enabled: editFlags.canCopy, label: "Copy", role: "copy" },
      { enabled: editFlags.canPaste, label: "Paste", role: "paste" },
      { type: "separator" },
      { label: "Select All", role: "selectAll" },
    );
  } else {
    items.push({ enabled: editFlags.canCopy, label: "Copy", role: "copy" });
  }

  if (isDeveloperMode()) {
    items.push(
      { type: "separator" },
      {
        click: () => {
          guest.inspectElement(params.x, params.y);
        },
        label: "Inspect Element",
      },
    );
  }

  return items;
}
