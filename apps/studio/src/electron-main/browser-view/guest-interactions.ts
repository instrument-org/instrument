import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import {
  clipboard,
  type ContextMenuParams,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { noop } from "radashi";

import { saveAsFromPage } from "./downloads";
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
    ...spellingItems(guest, params),
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
    if (isOpenable(url, places)) {
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

  items.push(...mediaItems(guest, params, places));

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

// Whether the guest can show the address itself: the web, and a file a local
// page links to, where the page may send a tab.
function isOpenable(url: string, places: GuestLinkPlaces) {
  return (isHttpUrl(url) || isFileUrl(url)) && places.mayOpen(url);
}

// A misspelled word's replacements at the top of the menu, as a browser puts
// them, then the word added to the dictionary so it stops being marked.
function spellingItems(
  guest: WebContents,
  { dictionarySuggestions, misspelledWord }: ContextMenuParams,
): MenuItemConstructorOptions[] {
  if (!misspelledWord) {
    return [];
  }
  const suggestions: MenuItemConstructorOptions[] =
    dictionarySuggestions.length > 0
      ? dictionarySuggestions.map((suggestion) => ({
          click: () => {
            guest.replaceMisspelling(suggestion);
          },
          label: suggestion,
        }))
      : [{ enabled: false, label: "No Guesses Found" }];
  return [
    ...suggestions,
    { type: "separator" },
    {
      click: () => {
        guest.session.addWordToSpellCheckerDictionary(misspelledWord);
      },
      label: "Add to Dictionary",
    },
    { type: "separator" },
  ];
}

const MEDIA_NOUNS = { audio: "Audio", image: "Image", video: "Video" };

// What a browser offers over an image, a video or an audio player, in its
// order, below the items for a link the media sits in.
function mediaItems(
  guest: WebContents,
  { hasImageContents, mediaType, srcURL, x, y }: ContextMenuParams,
  places: GuestLinkPlaces,
): MenuItemConstructorOptions[] {
  if (
    !srcURL ||
    (mediaType !== "image" && mediaType !== "video" && mediaType !== "audio")
  ) {
    return [];
  }
  const noun = MEDIA_NOUNS[mediaType];
  const items: MenuItemConstructorOptions[] = [];
  const { openInNewTab } = places;
  if (openInNewTab && isOpenable(srcURL, places)) {
    items.push({
      click: () => {
        openInNewTab(srcURL);
      },
      label: `Open ${noun} in New Tab`,
    });
  }
  items.push({
    click: () => {
      saveAsFromPage(guest, srcURL);
    },
    label: `Save ${noun} As…`,
  });
  if (mediaType === "image") {
    items.push({
      click: () => {
        guest.copyImageAt(x, y);
      },
      enabled: hasImageContents,
      label: "Copy Image",
    });
  }
  items.push(
    {
      click: () => {
        void clipboard.writeText(srcURL);
      },
      label: `Copy ${noun} Address`,
    },
    { type: "separator" },
  );
  return items;
}
