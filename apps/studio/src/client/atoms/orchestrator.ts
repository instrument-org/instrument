import { type FileSystemSortState } from "@/client/components/extend/file-system";
import {
  type SessionMessageDataPart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** A screen the window was on, so the sidebar can take the user back to it. */
export interface OrchestratorRecent {
  at: number;
  /** The page's icon, for a screen that is a page. */
  favicon?: string;
  /** Path and search together: the address of the screen, and its identity. */
  href: string;
  kind: "browser" | "file" | "folder" | "task";
  title: string;
}

export const RECENTS_MAX = 15;

export const orchestratorRecentsAtom = atomWithStorage<OrchestratorRecent[]>(
  "orchestrator.recents.v3",
  [],
  undefined,
  { getOnInit: true },
);

/**
 * What the window has on screen this moment, written by the screen that is
 * up and cleared when it leaves, so what goes with a message is what the
 * user was looking at and never a screen they left. The page's words and the
 * screen's address are added at send time by the layout, which holds both.
 */
export type ScreenView = Omit<
  SessionMessageDataPart.ViewContextDataPart,
  "page" | "url"
>;

export const screenViewAtom = atom<null | ScreenView>(null);

/**
 * A thread not yet started: its words and the topic it will be filed under.
 * What it has gathered (sites, files, folders) is its tab group, kept with
 * the window's tabs under the draft's group key; a file read in from bytes
 * rather than pointed at on disk is held in memory beside it.
 */
export interface Draft {
  createdAt: number;
  id: string;
  topicId?: string;
  updatedAt: number;
  words: string;
}

/** A file read into memory for a draft, when it had no place on disk to be opened from: sent with the words, shown as a tile. */
export interface DraftFile {
  /** The file's bytes, base64. */
  content: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
  /** A preview to draw, for an image. */
  url?: string;
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
export const draftsAtom = atomWithStorage<Draft[]>(
  "orchestrator.drafts.v1",
  [],
  undefined,
  { getOnInit: true },
);

/** The files read in for each draft, by draft id; in memory only, since bytes do not belong in storage. */
export const draftFilesAtom = atom<Record<string, DraftFile[]>>({});

/**
 * Where the draft being composed is drawn: docked in the right area with its
 * tabs under its words, expanded across the window with the inbox put away,
 * or shrunk to a bar along the bottom edge. Absent while no draft is up.
 */
export type DraftPlacement = "bar" | "docked" | "expanded";

export const openDraftAtom = atom<null | {
  id: string;
  placement: DraftPlacement;
}>(null);

/**
 * Whether the right area is shown at all. Closed, the inbox takes the whole
 * width and the tabs keep what they have for when something opens again, so
 * leaving a thread is one press rather than closing its tabs one by one.
 */
export const rightAreaOpenAtom = atom(true);

/** A tab of the window's browser: a browser session of the orchestrator's. */
export interface BrowserTab {
  /** The page's icon, as the page last announced it. */
  favicon?: string;
  /** The session id, which is the half of the target id a task can be handed. */
  id: string;
  openedAt: number;
  /** The address it was opened at, which a pin asks for again; the page may have moved on from it. */
  openedUrl?: string;
  /** The task whose browser this is, when it is not the window's own: a task the conversation started, browsing in the user's sight. */
  taskId?: TaskId;
  /** The page's title, as it last announced it; kept so a tab not yet shown still says what it is. */
  title?: string;
  /** The last page it showed, opened again when the tab comes back. */
  url?: string;
}

/**
 * The icon each site last announced, by origin, so a pin or a recent can
 * carry it before its tab is shown again.
 */
export const siteFaviconsAtom = atomWithStorage<Record<string, string>>(
  "orchestrator.site-favicons.v2",
  {},
  undefined,
  { getOnInit: true },
);

/** A page the browser showed, for the new-tab page: newest first, one per address. */
export interface VisitedPage {
  at: number;
  favicon?: string;
  title: string;
  url: string;
}

export const VISITED_MAX = 30;

export const visitedPagesAtom = atomWithStorage<VisitedPage[]>(
  "orchestrator.visited-pages.v1",
  [],
  undefined,
  { getOnInit: true },
);

/** A file the window can open in a tab: where it is on the computer, which is the tab's identity. */
export interface FileTab {
  hostPath: string;
  name: string;
}

/**
 * A tab of the window. A page is a browser session of the orchestrator's,
 * drawn by a guest the pool holds; a screen is anything else the product
 * shows (a folder, a file, a task, the apps, a new tab), addressed by the
 * route it is at, so navigating inside it changes the tab and not the row.
 */
export type TabVisit =
  | (BrowserTab & { kind: "page"; pageBackSteps?: number })
  | { at?: number; href: string; id: string; kind: "screen"; trail?: string[] };

export type WindowTab = TabHistory & TabVisit;

/**
 * Where a tab has been, and whether it was opened by something else.
 *
 * History belongs to a tab rather than to the window: back never moves you to
 * a different tab, which is the thing that makes a strip of them readable. A
 * page keeps its guest's native history; past and future retain visits across
 * the boundary between screens and pages.
 */
interface TabHistory {
  /**
   * The tab its group is anchored on: a thread's own screen, or a draft's
   * home page. First in the group and never closed.
   */
  anchor?: boolean;
  /** Where in `trail` the tab is standing; the end of it, until back is used. */
  at?: number;
  future?: TabVisit[];
  /**
   * The thread this tab belongs to, by its session id: what was opened while
   * the thread was on screen stays with the thread. Absent for a tab of the
   * window's own, opened outside any thread.
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
  /** The screen addresses this tab has been at, oldest first. */
  trail?: string[];
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
export const NEW_TAB_HREF = "/orchestrator/home";

/** The route a thread's screen is at, followed by the thread's session id. */
export const THREADS_HREF = "/orchestrator/threads";

/**
 * What the window has open: every group's tabs in strip order, which group
 * is on screen, and which tab each group last had up.
 */
export interface WindowTabs {
  /** The tab each group last had up, by its key, so coming back lands there. */
  activeByGroup?: Record<string, string>;
  activeId: null | string;
  /** The group on screen: a thread's session id or a draft's key; absent while nothing is on screen. */
  group?: string;
  /** The group the one on screen took over from, so a draft put away can hand the screen back. */
  previousGroup?: string;
  tabs: WindowTab[];
}

/**
 * The window's tabs, one list across every group, kept across launches on
 * this computer. Every screen reads and writes this one; a thread's tabs are
 * the ones in its group, and the thread itself is the first of them; a
 * draft's are the ones under its key, its home page first.
 */
export const windowTabsAtom = atomWithStorage<WindowTabs>(
  "orchestrator.tabs.v7",
  { activeId: null, tabs: [] },
  undefined,
  { getOnInit: true },
);

/** Tabs closed this launch, newest last, for Shift+Cmd+T. A page comes back at its last address. */
export const closedTabsAtom = atom<WindowTab[]>([]);

export const SIDEBAR_WIDTH_MIN = 320;
/** Wide enough for the inbox to lay its rows down to one line each beside the column. */
export const SIDEBAR_WIDTH_MAX = 1200;
export const SIDEBAR_WIDTH_DEFAULT = 400;

/** The chat pane's width in CSS px, dragged by its right edge. It holds the conversation, so it never closes. */
export const orchestratorSidebarWidthAtom = atomWithStorage<number>(
  "orchestrator.sidebar-width.v1",
  SIDEBAR_WIDTH_DEFAULT,
  undefined,
  { getOnInit: true },
);

/**
 * Which of the file browser's layouts it opens in, and whether it lists
 * dotfiles.
 *
 * Both are held here rather than inside the browser because the browser is
 * rebuilt every time a folder is opened into it, and a preference that resets
 * on the next folder is not one anybody sets twice.
 */
export const computerViewAtom = atomWithStorage<
  "columns" | "gallery" | "icons" | "list"
>("orchestrator.computer-view.v1", "columns", undefined, { getOnInit: true });

/** Off by default, the way every file browser starts: a folder of dotfiles is a folder whose own contents are harder to find. */
export const computerHiddenFilesAtom = atomWithStorage<boolean>(
  "orchestrator.computer-hidden-files.v1",
  false,
  undefined,
  { getOnInit: true },
);

/**
 * The order a folder's rows are in, held with the layout for the same reason.
 * The recents keep their own order, newest shown first, and do not write here.
 */
export const computerSortAtom = atomWithStorage<FileSystemSortState>(
  "orchestrator.computer-sort.v1",
  { direction: "asc", key: "name" },
  undefined,
  { getOnInit: true },
);

/** How wide the columns view's columns are, in CSS px, dragged at any column's right edge. */
export const computerColumnWidthAtom = atomWithStorage<number>(
  "orchestrator.computer-column-width.v1",
  240,
  undefined,
  { getOnInit: true },
);

/** A thing the user pinned to the sidebar: a page by its address, or a screen by its route. */
export interface Pin {
  favicon?: string;
  id: string;
  kind: "page" | "screen";
  /** A page's address or a screen's route. */
  target: string;
  title: string;
}

export const pinsAtom = atomWithStorage<Pin[]>(
  "orchestrator.pins.v1",
  [],
  undefined,
  { getOnInit: true },
);

/** Every tab id the window holds, past and future visits included, so nothing is opened twice. */
export const everyTabIdAtom = atom(
  (get) =>
    new Set(
      get(windowTabsAtom).tabs.flatMap((tab) => [
        tab.id,
        ...(tab.past ?? []).map((visit) => visit.id),
        ...(tab.future ?? []).map((visit) => visit.id),
      ]),
    ),
);
