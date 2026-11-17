import { type ChosenItem } from "@/shared/drafts";
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
import { atom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";

import { keptAtom } from "@/client/lib/kept-state";

/**
 * What each tab's chat list is narrowed to, by the tab's id: its project,
 * its place, its search and its marks. A tab not named here lists every
 * chat, so a new tab's list opens in the inbox whatever another tab's
 * stands in.
 */
export const chatFiltersByTabAtom = atom<
  Readonly<Partial<Record<string, ChatFilters>>>
>({});

/** What one tab's chat list is narrowed to, and narrowing it. */
export const tabChatFiltersAtom = atomFamily((tabId: string) =>
  atom(
    (get) => get(chatFiltersByTabAtom)[tabId] ?? NO_FILTERS,
    (get, set, update: SetStateAction<ChatFilters>) => {
      const byTab = get(chatFiltersByTabAtom);
      const next =
        typeof update === "function"
          ? update(byTab[tabId] ?? NO_FILTERS)
          : update;
      set(chatFiltersByTabAtom, { ...byTab, [tabId]: next });
    },
  ),
);

/** The files cut in this window, by host path: a paste of exactly these moves them. */
export const filesCutAtom = atom<readonly string[]>([]);

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

/** The places the rail at the window's edge switches between: the chat, the files, the browser, and the apps. */
export type AppPlace = "apps" | "browser" | "chat" | "files";

/**
 * Search Chats was asked for and the inbox's search has not taken the
 * keyboard yet: the inbox of the tab up takes it once it is drawn.
 */
export const chatSearchAskedAtom = atom(false);

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
   * The tab group it is in, by the group's own id (`newGroupKey`), which
   * names no chat or draft: none for a page an agent made with no tab yet.
   */
  group?: string;
  /**
   * The group it last moved here from, which tells the chat whose group it
   * joined, or left, that it moved rather than opened or closed.
   */
  movedFrom?: string;
  /** The chat whose agent opened it; absent for a tab the person opened. */
  openedBy?: ChatId;
  /**
   * On a chat's tab, when the person last sent the chat a message from it.
   * Of a chat's tabs, the one sent from last is where its agent works
   * (`workingTabOf`).
   */
  promptedAt?: number;
  /**
   * The side of its group the tab stands on: absent for the first, the left,
   * and 1 for the second, the right, which a group has only while some tab
   * stands there (`groupLayoutOf`).
   */
  side?: 1;
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

/**
 * The address a new tab opens at: a new chat, which is the new tab, its
 * draft named in the address once it has words (`newChatHref`).
 */
export const NEW_TAB_HREF = "/chats";

/** The web's starting view beside a chat: an address field over the sites kept and lately seen. */
export const BROWSER_HREF = "/browser";

/** The address of the apps: the tab the Apps place opens on. */
export const APPS_HREF = "/apps";

/** The address a group's new tab opens at: a new chat, in every group. */
export function newTabHrefOf(_group?: string): string {
  return NEW_TAB_HREF;
}

/** The route a chat's screen is at, followed by the chat's id. */
export const CHATS_HREF = "/chats";

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
 * Whether the Finder shows its sidebar of places beside the folder, where the
 * tab is wide enough to hold both. One answer for every Finder. A narrow tab lays the places over the folder only
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
