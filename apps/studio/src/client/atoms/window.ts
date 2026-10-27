import { type ChosenItem, draftGroupOf, draftOfGroup } from "@/shared/drafts";
import { PANE_DEFAULT_SHARE } from "@/client/atoms/right-pane";
import {
  type FileSystemListColumn,
  type FileSystemGroupKey,
  type FileSystemSortState,
} from "@/client/components/extend/file-system";
import { type ChatFilters, NO_FILTERS } from "@/client/components/window/chats";
import { type TabHistory as ScreenHistory } from "@/shared/tabs";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { atom } from "jotai";

import { keptAtom } from "@/client/lib/kept-state";
import { folderHref } from "@/shared/computer-href";

/**
 * What the chat column is narrowed to.
 *
 * Here rather than in the pane that reads it, because anything that opens a
 * brand new chat has to put the list back where that chat is visible: a
 * column standing in a topic or a place is a column the new chat is very
 * likely not in, and a button that appears to do nothing is a button someone
 * presses again.
 */
export const chatFiltersAtom = atom<ChatFilters>(NO_FILTERS);

/**
 * What a screen shows, in the terms the conversation is told it; see
 * `TabSurface.view`.
 */
export type ScreenView = Omit<
  SessionMessageDataPart.ViewContextDataPart,
  "page" | "url"
>;

/** A Finder's folder and what is selected in it, by host path. */
export interface FinderShown {
  folder: string;
  selected: ChosenItem[];
}

/**
 * One window along the foot: a draft being written, or a chat floating in
 * its small view, and how the window stands. A chat's entry remembers the
 * draft it grew from, so the window that was the draft is the window that
 * is the chat, with no arrival between them.
 */
export type ComposeEntry = { placement: ComposePlacement } & (
  | { draftId: string; kind: "draft" }
  | { chatId: ChatId; fromDraft?: string; kind: "chat" }
);

/** How a window stands: docked along the window's foot, grown to fill the window, or put down to a bar along the foot. */
export type ComposePlacement = "bar" | "docked" | "expanded";

/** The group key of what a window shows: the draft's tabs, or the chat's. */
export function composeKeyOf(entry: ComposeEntry): string {
  return entry.kind === "draft" ? draftGroupOf(entry.draftId) : entry.chatId;
}

/** The chats up in a window of their own over the row: docked or grown, not put down to a bar. */
export function chatsOutOf(entries: ComposeEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.kind === "chat" && entry.placement !== "bar" ? [entry.chatId] : [],
    ),
  );
}

/**
 * The windows floating over the row, the way a mail client keeps several
 * compose windows along its foot, oldest first: the newest stands at the
 * right, and the ones there is no room for are not drawn. The drafts being
 * written and the chats in their small views share the row. Kept across
 * launches, so what was floating when the app quit floats again; the drafts
 * themselves are in `draftsAtom` (`client/drafts/store.ts`).
 */
export const composeAtom = keptAtom<ComposeEntry[]>("layout", "compose.v2", []);

/** The places the rail at the window's edge switches between: the chat, the files, the browser, and the apps. */
export type AppPlace = "apps" | "browser" | "chat" | "files";

/**
 * The chat a tab last had open, so Chat in the rail takes a tab back to it.
 * Null for the inbox alone.
 */
export const chatGroupAtom = keptAtom<null | string>(
  "layout",
  "chat-group.v2",
  null,
);

/**
 * The folder a tab last stood in on Files, by its address, so Files in the
 * rail takes a tab back to it. Null until a tab has been there.
 */
export const filesFolderAtom = keptAtom<null | string>(
  "layout",
  "files-folder.v1",
  null,
);

/** Where Files opens: the folder a tab last stood in, or the home folder before one has. */
export const filesHrefAtom = atom(
  (get) => get(filesFolderAtom) ?? folderHref("~"),
);

/**
 * Whether the inbox column is shown. Put away, a chat and its tabs have
 * the window to themselves; it comes back on its own when nothing is left
 * on screen without it.
 */
export const inboxOpenAtom = keptAtom<boolean>("layout", "inbox-open.v1", true);

/**
 * Whether each group's pane is open, by the chat's id or the draft's
 * key: the tabs beside the conversation, put away and brought back
 * by the toggle over it. A group not named here has its pane open, so a
 * chat whose agent opened something shows it on arrival.
 */
export const paneOpenByGroupAtom = keptAtom<Record<string, boolean>>(
  "layout",
  "pane-open.v2",
  {},
);

/** The pane's share of the row beside the conversation, dragged at its edge; one share for every chat. */
export const paneShareAtom = keptAtom<number>(
  "view",
  "pane-share.v1",
  PANE_DEFAULT_SHARE,
);

/** A tab of the window's browser: a browser session of the window's own, under `WINDOW_ID`. */
export interface BrowserTab {
  /** The page's icon, as the page last announced it. */
  favicon?: string;
  /** The session id, which is the half of the target id a task can be handed. */
  id: string;
  openedAt: number;
  /** The address it was opened at, which a pin asks for again; the page may have moved on from it. */
  openedUrl?: string;
  /** The page's title, as it last announced it; kept so a tab not yet shown still says what it is. */
  title?: string;
  /** The last page it showed, opened again when the tab comes back. */
  url?: string;
}

/** A file the window can open in a tab: where it is on the computer, which is the tab's identity. */
export interface FileTab {
  hostPath: string;
  name: string;
}

/**
 * A tab of the window. A page is a browser session of the window's own,
 * drawn by a guest the pool holds; a screen is anything else the product
 * shows (a folder, a file, a task, the apps, a new tab), addressed by the
 * route it is at, so navigating inside it changes the tab and not the row.
 */
export type TabVisit =
  | (BrowserTab & { kind: "page" })
  | {
      /** Where the screen's own router has been, and where along it the tab stands; one address until it has moved. */
      history?: ScreenHistory;
      href: string;
      id: string;
      kind: "screen";
    };

export type WindowTab = TabHistory & TabVisit;

/**
 * Where a tab has been, and whether it was opened by something else.
 *
 * History belongs to a tab rather than to the window: back never moves you to
 * a different tab, which is the thing that makes a strip of them readable. A
 * page keeps its guest's native history and a screen its router's; past and
 * future retain visits across the boundary between screens and pages.
 */
interface TabHistory {
  future?: TabVisit[];
  /**
   * The chat this tab belongs to, by its id, or the draft's key:
   * what was opened while the chat was on screen stays with the chat.
   */
  group?: string;
  /**
   * True when this tab was opened from another one rather than by the user
   * asking for a tab. Back from the start of such a tab closes it, which is
   * what a tab opened to show one thing should do when you are done with it.
   */
  isOpened?: boolean;
  /** Visits across the screen/browser boundary; each guest keeps its native history. */
  past?: TabVisit[];
  /**
   * The strip key of the tab this one took the place of, so the strip sees
   * one tab changing rather than one leaving and another arriving: a new tab
   * that became a page, a page that went back to being a new tab.
   */
  stripKey?: string;
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) {
    return;
  }
  try {
    return new URL(url).origin;
  } catch {
    return;
  }
}

/** The address a new tab opens at: the page with the box that reaches everything. */
export const NEW_TAB_HREF = "/new-tab";

/** The web's starting view beside a chat: an address field over the sites kept and lately seen. */
export const BROWSER_HREF = "/browser";

/** The address of the apps: the tab the Apps place opens on. */
export const APPS_HREF = "/apps";

/**
 * The address a group's new tab opens at: the page that reaches everything
 * for a draft, and the web's starting view for a chat, whose tabs are its
 * browsers.
 */
export function newTabHrefOf(group: string | undefined): string {
  return draftOfGroup(group) === undefined ? BROWSER_HREF : NEW_TAB_HREF;
}

/** The route a chat's screen is at, followed by the chat's id. */
export const CHATS_HREF = "/chats";

export const SIDEBAR_WIDTH_MIN = 320;
/** The inbox's widest: a list to pick a chat from, never a page of its own, so the room past this goes to the chat beside it. */
export const SIDEBAR_WIDTH_MAX = 440;

const storedInboxWidthAtom = keptAtom<number>(
  "view",
  "inbox-width.v1",
  SIDEBAR_WIDTH_MIN,
);

/** The inbox column's width in CSS px, dragged by its right edge, and read within its widest whatever was stored. */
export const inboxWidthAtom = atom(
  (get) => Math.min(get(storedInboxWidthAtom), SIDEBAR_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedInboxWidthAtom, width);
  },
);

/**
 * The layout last chosen anywhere: what a folder with no layout of its own
 * opens in when arrived at directly, a new tab's first folder among them.
 * Walking from folder to folder keeps whatever layout is on screen instead,
 * the way a Finder window does.
 */
export const computerViewAtom = keptAtom<
  "columns" | "gallery" | "icons" | "list" | "table"
>("view", "computer-view.v2", "columns");

/** Off by default, the way every file browser starts: a folder of dotfiles is a folder whose own contents are harder to find. */
export const computerHiddenFilesAtom = keptAtom<boolean>(
  "view",
  "computer-hidden-files.v1",
  false,
);

/**
 * The layout, order and grouping each folder was last set to by hand, by
 * where it is on the computer, the way the Finder keeps them with the
 * folder. The order and grouping hold however the folder is reached; the
 * layout only when it is arrived at directly, since walking keeps the tab's
 * own. All are kept whenever any is set, and walking into a folder sets
 * none. The recents are kept under their root.
 */
export const computerFolderViewsAtom = keptAtom<
  Record<string, ComputerFolderView>
>("view", "computer-folder-views.v2", {});

/**
 * The folders opened in place in the list, by where each is on the
 * computer, newest last. One set for every Finder, the way the Finder keeps
 * them: a folder stands open wherever a list shows it, in any tab or window,
 * reached any way, until it is closed.
 */
export const computerOpenFoldersAtom = keptAtom<string[]>(
  "view",
  "computer-open-folders.v1",
  [],
);

export interface ComputerFolderView {
  /** Absent for a folder last set before grouping, which is ungrouped. */
  group?: FileSystemGroupKey | null;
  sort: FileSystemSortState;
  view: "columns" | "gallery" | "icons" | "list" | "table";
}

/**
 * Whether a file tab shows the tree beside its document. One answer for
 * every file tab: the tree is a way of working, not a property of a file.
 */
export const fileTreeOpenAtom = keptAtom<boolean>(
  "view",
  "file-tree-open.v1",
  true,
);

/**
 * Whether the Finder shows its sidebar of places beside the folder, where the
 * tab is wide enough to hold both. One answer for every Finder, the way the
 * tree beside a file is. A narrow tab lays the places over the folder only
 * while asked for, whatever this says.
 */
export const finderPlacesOpenAtom = keptAtom<boolean>(
  "view",
  "finder-places-open.v1",
  true,
);

/** How wide the Finder's sidebar is, in CSS px, dragged at its right edge. One width for every Finder. */
export const finderPlacesWidthAtom = keptAtom<number>(
  "view",
  "finder-places-width.v1",
  176,
);

/** How wide the tree beside a file is, in CSS px, dragged at its right edge. One width for every file tab, as the tree is one way of working. */
export const fileTreeWidthAtom = keptAtom<number>(
  "view",
  "file-tree-width.v1",
  240,
);

/** How wide a folder is beside a file open in it, in CSS px, dragged at its right edge. One width for every view. */
export const finderBesideWidthAtom = keptAtom<number>(
  "view",
  "finder-beside-width.v1",
  300,
);

/**
 * The list view's columns beside Name, picked from its header's menu. One set
 * for every folder, the way the Finder's own defaults are one set.
 */
export const computerListColumnsAtom = keptAtom<FileSystemListColumn[]>(
  "view",
  "computer-list-columns.v1",
  ["updatedAt", "size", "kind"],
);

/** How wide the list view's columns beside Name are, in CSS px, dragged at their headers; a column left out is at its default. */
export const computerListColumnWidthsAtom = keptAtom<
  Partial<Record<FileSystemListColumn, number>>
>("view", "computer-list-column-widths.v1", {});

/** How wide the columns view's columns are, in CSS px, dragged at any column's right edge. */
export const computerColumnWidthAtom = keptAtom<number>(
  "view",
  "computer-column-width.v1",
  240,
);
