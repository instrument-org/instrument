import { PANE_DEFAULT_SHARE } from "@/client/atoms/right-pane";
import {
  type FileSystemListColumn,
  type FileSystemSortState,
} from "@/client/components/extend/file-system";
import { type PromptInputDraft } from "@/client/components/prompt-input";
import { type ChatFilters, NO_FILTERS } from "@/client/components/window/chats";
import { type TabHistory as ScreenHistory, type TabId } from "@/shared/tabs";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";

import { keptAtom } from "@/client/lib/kept-state";

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
 * What each screen shows, by the tab it is drawn in (one of the window's own
 * tabs, or a group's tab beside a chat or in a draft's band), written by the
 * screen and cleared when it leaves. What goes with a message is read from
 * the tab in view at the moment of sending, so it is what the user was
 * looking at and never a screen they left. The page's words and the
 * screen's address are added at send time by the layout, which holds both.
 */
export type ScreenView = Omit<
  SessionMessageDataPart.ViewContextDataPart,
  "page" | "url"
>;

export const screenViewsAtom = atom<Readonly<Record<string, ScreenView>>>({});

/** A file or folder on this computer picked to go with a draft, by its path. */
export interface ChosenItem {
  kind: "file" | "folder";
  path: string;
}

/** A Finder's folder and what is selected in it, by host path. */
export interface FinderShown {
  folder: string;
  selected: ChosenItem[];
}

/**
 * What each of the window's own Files tabs has in its Finder, by the tab's
 * id, so a draft opened over one, or with one up behind it, names them as
 * the chat will be told them, whichever tab is up by the time it is sent.
 */
export const findersByTabAtom = atom<Readonly<Record<string, FinderShown>>>({});

/**
 * A chat not yet started: its words and the topic it will be filed under.
 * What it has gathered (sites, files, folders) is its tab group, kept with
 * the window's tabs under the draft's group key; what its composer holds
 * besides the words is kept in memory beside it.
 */
export interface Draft {
  /**
   * Files and folders the person opened the draft on by name, from a menu or
   * a button over them: held for the chat whatever the window moves on to,
   * until the person leaves one out.
   */
  chosen?: ChosenItem[];
  createdAt: number;
  id: string;
  /**
   * The thing the draft was opened over, when the window stood in a place
   * with a tab up: that tab, by its group and id. A pointer rather than a
   * copy or a tab of the draft's own, so the draft says what the screen
   * already gives it and the chat is told about it as it starts. A folder,
   * file, or app's front on one of the window's own tabs is that tab, by its
   * id. Cleared when the person leaves it out.
   */
  included?: { appTabId: TabId } | { group: string; tabId: string };
  /** Tabs the window had up behind the draft that the person left out of it, by id. */
  leftBehind?: string[];
  topicId?: string;
  /**
   * Who settled the topic: the person, by picking or clearing one, or the
   * decision model, from what the draft says. Absent while neither has, which
   * is the only time a draft is filed on its own.
   */
  topicSource?: "chosen" | "suggested";
  updatedAt: number;
  words: string;
}

/** The group key a draft's tabs are kept under. */
export function draftGroupOf(draftId: string): string {
  return `draft:${draftId}`;
}

/** The draft a group key names, if it names one. */
export function draftOfGroup(group: string | undefined): string | undefined {
  return group?.startsWith("draft:") ? group.slice("draft:".length) : undefined;
}

/**
 * Every draft not yet started, newest last, kept on this computer across
 * launches the way the tabs are: a draft put away is still in Drafts.
 */
export const draftsAtom = keptAtom<Draft[]>("drafts", "drafts.v2", []);

/** How long a draft's words are left alone before its record is written. */
const DRAFT_WORDS_SETTLE_MS = 300;

/** Each draft's pending write of its words to its record. */
const draftWordsWrites = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A draft's words: the one place they are typed into and read from, by the
 * composer, its bar, the Drafts list and the send alike. They start as the
 * record's (a draft made with words in it, or one kept past a launch), and
 * what is typed is written back to the record a beat later rather than on
 * every key: writing the record lays the whole window out again, transcripts
 * and all, and that on each keystroke is felt in the keys.
 */
export const draftWordsAtom = atomFamily((draftId: string) => {
  const typed = atom<null | string>(null);
  const words = atom(
    (get) =>
      get(typed) ??
      get(draftsAtom).find((draft) => draft.id === draftId)?.words ??
      "",
    (get, set, update: SetStateAction<string>) => {
      const next = typeof update === "function" ? update(get(words)) : update;
      set(typed, next);
      clearTimeout(draftWordsWrites.get(draftId));
      draftWordsWrites.set(
        draftId,
        setTimeout(() => {
          draftWordsWrites.delete(draftId);
          set(draftsAtom, (current) =>
            current.map((draft) =>
              draft.id === draftId && draft.words !== next
                ? { ...draft, updatedAt: Date.now(), words: next }
                : draft,
            ),
          );
        }, DRAFT_WORDS_SETTLE_MS),
      );
    },
  );
  return words;
});

/** Lets go of a draft's words, for a draft sent or thrown away. */
export function forgetDraftWords(draftId: string) {
  clearTimeout(draftWordsWrites.get(draftId));
  draftWordsWrites.delete(draftId);
  draftWordsAtom.remove(draftId);
}

/**
 * What each draft's composer held besides its words when it was last put
 * away, by draft id: the files and folders it was given, restored when the
 * draft comes back up. In memory only, since bytes do not belong in storage.
 */
export const draftSnapshotsAtom = atom<Record<string, PromptInputDraft>>({});

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

/**
 * The windows floating over the row, the way a mail client keeps several
 * compose windows along its foot, oldest first: the newest stands at the
 * right, and the ones there is no room for are not drawn. The drafts being
 * written and the chats in their small views share the row. Kept across
 * launches, so what was floating when the app quit floats again; the drafts
 * themselves are in `draftsAtom`.
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

/** A page the browser showed, for the new-tab page and the address field's completions: newest first, one per address. */
export interface VisitedPage {
  at: number;
  favicon?: string;
  title: string;
  url: string;
}

/** Enough history for the address field to finish the sites a person goes back to, which a page's handful of rows never needed. */
export const VISITED_MAX = 500;

export const visitedPagesAtom = keptAtom<VisitedPage[]>(
  "history",
  "visited-pages.v1",
  [],
);

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
 * The layout a folder with no layout of its own opens in, when the browser
 * opens on it fresh: the one last chosen anywhere. Walking into such a folder
 * keeps whatever layout is on screen instead, the way a Finder window does.
 */
export const computerViewAtom = keptAtom<
  "columns" | "gallery" | "icons" | "list"
>("view", "computer-view.v1", "columns");

/** Off by default, the way every file browser starts: a folder of dotfiles is a folder whose own contents are harder to find. */
export const computerHiddenFilesAtom = keptAtom<boolean>(
  "view",
  "computer-hidden-files.v1",
  false,
);

/**
 * The order a folder with no order of its own opens in, the same way as the
 * layout above. The recents keep their own order, newest shown first, and do
 * not write here.
 */
export const computerSortAtom = keptAtom<FileSystemSortState>(
  "view",
  "computer-sort.v1",
  { direction: "asc", key: "name" },
);

/**
 * The layout and order each folder was last left in, by where it is on the
 * computer, the way the Finder keeps them with the folder: a folder reached
 * again, by any way in, looks the way it was left. Both are kept whenever
 * either changes, so a folder's look is one thing rather than two halves
 * that each fall back on their own. The recents are kept under their root.
 */
export const computerFolderViewsAtom = keptAtom<
  Record<string, ComputerFolderView>
>("view", "computer-folder-views.v1", {});

export interface ComputerFolderView {
  sort: FileSystemSortState;
  view: "columns" | "gallery" | "icons" | "list";
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

/**
 * The elements screens draw a page's guest into, by the group the page's
 * tab is kept under: a file tab drawing a page's file beside its tree keeps
 * that page as a tab in a group of its own, off every strip, and says here
 * where the browser is to draw it. A slot inside a surface floating over the
 * window (Quick Look) names the layer its page stands on, and is shown for as
 * long as it is there; a slot in one of the window's tabs is shown while
 * that tab is up. In memory only, with the elements.
 */
export const pageSlotsAtom = atom<
  Record<
    string,
    {
      insideOverlay?: boolean;
      into: HTMLElement | null;
      isShown?: boolean;
      layer?: number;
    }
  >
>({});

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

/** A page the user kept, shown on the browser's starting view. */
export interface Bookmark {
  id: string;
  title: string;
  url: string;
}

export const bookmarksAtom = keptAtom<Bookmark[]>(
  "bookmarks",
  "bookmarks.v1",
  [],
);
