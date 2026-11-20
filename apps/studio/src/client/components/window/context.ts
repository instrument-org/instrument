import { type ChatId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";

/**
 * What an opener is told: a tab of the window's own, or a tab of its own in
 * the group; the group the thing belongs to, when not the one on screen; and
 * whether to bring that group on screen at it, for what the user asked for by
 * name rather than what an agent opened behind.
 */
export interface OpenOptions {
  /** Puts the thing in front of its group without bringing the group on screen: for a group drawn by a window of its own. */
  activate?: boolean;
  /** With `newTab` or `chat`, the tab waits behind, as a browser's does for a middle click, a Cmd-click or Open in New Tab. */
  behind?: boolean;
  /**
   * The chat it was asked from, whose tab it opens beside: the tab `from`
   * names, else the chat's tab the person last sent from.
   */
  chat?: ChatId;
  /** The tab it was asked from, by its id, which `into: "split"` opens across from; the tab up with the keyboard where none is named. */
  from?: string;
  /** The tab group it belongs to, by its id, when not the one on screen. */
  group?: string;
  /**
   * In the tab up, whatever another tab shows: what the app opens on its
   * own, with nobody pressing anything, and what a surface opens in its own
   * tab, as a folder linked from a document there.
   */
  here?: boolean;
  /**
   * A tab of the window's own, across its bar, wherever it was asked for
   * from: what a middle click, a Cmd-click, or Open in New Tab asks.
   * `"reuseBlank"` is how a browser opens its own pages: a new tab right
   * after the tab up, or the tab up itself when it is a blank New Tab
   * (`reuseBlankOf`).
   */
  newTab?: boolean | "reuseBlank";
  /**
   * A window of its own beside this one, with the thing as its tab: what
   * Shift-click and Open in New Window ask. A page opens on its own there,
   * as a site, whichever chat it was opened from.
   */
  newWindow?: boolean;
  /**
   * A place picked from a menu, over whatever else the open would do: the
   * other side of the group it was asked from, up there and made where the
   * group has one side (`split`, Open in Split); the first tab of a new tab
   * group, up in the window (`group`, Open in New Tab Group); or the first
   * tab of a new window (`window`, Open in New Window).
   */
  into?: "group" | "split" | "window";
  /** A tab of its own in the group, beside the one up rather than in its place: what a conversation or an agent opens. */
  ownTab?: boolean;
  /** Takes the place of the address the window's tab stands on rather than stepping on from it: a screen handing its file to the page. */
  replace?: boolean;
  show?: boolean;
}

/**
 * The part of an open that asks for a place of the window's own, a tab or a
 * window, which a surface drawing things in its own place passes on as it
 * was asked; nothing for an open the surface answers itself.
 */
export function ownPlaceOf(options?: OpenOptions): OpenOptions | undefined {
  if (options?.into) {
    return {
      into: options.into,
      ...(options.from === undefined ? {} : { from: options.from }),
    };
  }
  if (options?.newWindow) {
    return { newWindow: true };
  }
  if (options?.newTab === true) {
    return { behind: options.behind, newTab: true };
  }
  return undefined;
}

/** Whether an open asks for a tab or a window of the window's own rather than the surface's place. */
export function asksOwnPlace(options?: OpenOptions): boolean {
  return ownPlaceOf(options) !== undefined;
}

/** What every screen of the window shares. */
export interface WindowContextValue {
  /** Opens a draft of a new chat with the line already in it, to be read and sent by the person; inside a chat, sends the line there. */
  ask: (prompt: string) => void;
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserTabsHandle | null;
  /**
   * Opens a new draft and moves these staged asks into it as pills, for a
   * file with no chat beside it; inside a draft, moves them into that one.
   */
  moveAsksToDraft?: (ids: string[]) => void;
  /** Navigates this surface's tab, and a conversation opens a tab of its own beside it; `newTab` asks for a tab of the window's own from either. */
  openPage: (url: string, options?: OpenOptions) => void;
  /** Opens a path the conversation named: a file in its viewer, a folder as the folder view standing in it. */
  openPath: (path: string, options?: OpenOptions) => void;
  /** As `openPage`, for a screen of the app. */
  openScreen: (href: string, options?: OpenOptions) => void;
  /** The head of the tab's row, ahead of back and forward, where a screen draws the toggle for a panel along its left edge; null until the row is up. */
  rowLead?: HTMLElement | null;
  /** The end of the field in the tab's row, where a screen says something about what it shows in passing; null until the row is up. */
  rowField?: HTMLElement | null;
  /** Beside the arrows in the tab's row, where a page drawn inside a screen puts its reload; null until the row is up. */
  rowReload?: HTMLElement | null;
  /** The tail of the tab's row, where a screen draws what it can do with what it shows where it has no `rowView`; null until the row is up. */
  rowTail?: HTMLElement | null;
  /** The end of the view's own row under the bookmarks bar, where a screen draws what acts on the file it shows; absent where the tab has no such row, and null until it is up. */
  rowView?: HTMLElement | null;
  /** The chat a surface is drawn inside, when it is one; absent at the top level, where `ask` opens a draft. */
  chatId?: ChatId;
}

export const WindowContext = createContext<null | WindowContextValue>(null);

export function useWindow(): WindowContextValue {
  const value = useContext(WindowContext);
  if (!value) {
    throw new Error("useWindow is only for screens of the app window");
  }
  return value;
}
