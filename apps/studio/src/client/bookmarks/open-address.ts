import {
  type OpenAllTab,
  type OpenOptions,
  useWindow,
  WindowContext,
} from "@/client/components/window/context";
import { isGroupScreenHref } from "@/client/components/window/group-screen";
import { matchScreen } from "@/client/components/window/window-href";
import {
  type Bookmark,
  type Bookmarks,
  OTHER_ROOT,
  bookmarksDirectlyIn,
  itemsOfFolder,
  rootItems,
} from "@/shared/bookmarks";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import { useContext } from "react";

import { type AddressTarget, hrefOfPath, targetOfAddress } from "./address";

/**
 * The screen href an address of the app's own opens at: a file's or a
 * folder's in Files, and a built-in page named by its screen
 * (`/screen/activity`) at the page's own href, which a tab can stand at.
 */
export function hrefOfTarget(
  target: Exclude<AddressTarget, { kind: "page" }>,
): string {
  if (target.kind === "path") {
    return hrefOfPath(target);
  }
  const screen = matchScreen(target.href);
  if (screen.kind === "namedScreen" && isScreenName(screen.name)) {
    const own = SCREENS[screen.name];
    return "href" in own ? own.href : target.href;
  }
  return target.href;
}

/**
 * Whether a tab can be taken over by a screen: anything a group's tab stands
 * at, a chat included. The chat list is no page, so it opens in the side
 * panel instead.
 */
function canStandHere(href: string): boolean {
  const { kind } = matchScreen(href);
  return kind !== "chats" && (isGroupScreenHref(href) || kind === "chat");
}

/** Where an address opens: the tab it was chosen from (`here`), and the window's own opens. */
export interface AddressSinks {
  /** This tab goes to a site. */
  loadHere?: (url: string) => void;
  openPage: (url: string, options?: OpenOptions) => void;
  openScreen: (href: string, options?: OpenOptions) => void;
  /** This tab goes to a screen of the app's own, a chat's included. */
  visitHere?: (href: string) => void;
}

/**
 * Opens any address, a site's or the app's own, the way a bookmark opens
 * it. With no `asked`, a plain click: the tab it was chosen from goes there,
 * whatever it names (a site, a file, a folder, a chat, a built-in page), and
 * Back returns. With `asked`, the window's one open (`openPage`,
 * `openScreen`) places it as any other open with those options is placed:
 * a new tab after this one, in front or waiting behind, the other side, a
 * new tab group or a new window.
 */
export function openAddressBy(
  address: string,
  asked: OpenOptions | undefined,
  sinks: AddressSinks,
): void {
  const target = targetOfAddress(address);
  if (!target) {
    return;
  }
  if (target.kind === "page") {
    if (asked === undefined && sinks.loadHere) {
      sinks.loadHere(target.url);
    } else {
      sinks.openPage(target.url, asked);
    }
    return;
  }
  const href = hrefOfTarget(target);
  if (asked === undefined && sinks.visitHere && canStandHere(href)) {
    sinks.visitHere(href);
  } else {
    sinks.openScreen(href, asked);
  }
}

/** An open asked of a bookmark, whose new tab goes at the end as a browser's does (`OpenOptions.atEnd`). */
export function askedOfBookmark(asked: OpenOptions): OpenOptions {
  return asked.newTab === undefined ? asked : { ...asked, atEnd: true };
}

/** `openAddressBy` against this window, `here` being the tab the address is chosen from. */
export function useOpenAddress(
  here: Pick<AddressSinks, "loadHere" | "visitHere"> = {},
) {
  const appWindow = useWindow();
  return (address: string, asked?: OpenOptions) => {
    openAddressBy(address, asked && askedOfBookmark(asked), {
      ...here,
      openPage: (url, options) => {
        appWindow.openPage(url, options);
      },
      openScreen: (href, options) => {
        appWindow.openScreen(href, options);
      },
    });
  };
}

/**
 * What a folder's Open All opens, by the folder's id or All Bookmarks'
 * (`OTHER_ROOT`): the bookmarks directly in it, in order, and none in a
 * folder inside it, as Chrome opens a folder's.
 */
export function bookmarksToOpen(state: Bookmarks, of: string): Bookmark[] {
  if (of === OTHER_ROOT) {
    return rootItems(state, OTHER_ROOT).flatMap((item) =>
      item.kind === "bookmark" ? [item.bookmark] : [],
    );
  }
  return bookmarksDirectlyIn(itemsOfFolder(state, of));
}

/** The tab an address is among several opened together (`openAll`): a site's page, or the screen of the app's own it names. */
export function openAllTabOf(address: string): OpenAllTab | undefined {
  const target = targetOfAddress(address);
  if (!target) {
    return undefined;
  }
  return target.kind === "page"
    ? { kind: "page", url: target.url }
    : { href: hrefOfTarget(target), kind: "screen" };
}

/** Opens bookmarks as one new tab group, up in this window or as a window of its own: a folder's Open All. Nothing outside a window. */
export function useOpenAllBookmarks() {
  const appWindow = useContext(WindowContext);
  return (bookmarks: readonly Bookmark[], into: "group" | "window") => {
    appWindow?.openAll?.(
      bookmarks.flatMap((bookmark) => openAllTabOf(bookmark.url) ?? []),
      into,
    );
  };
}
