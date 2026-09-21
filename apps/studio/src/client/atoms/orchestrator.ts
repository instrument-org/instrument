import { TASK_PANE_DEFAULT_SHARE } from "@/client/atoms/task-pane";
import { type FileSystemSortState } from "@/client/components/extend/file-system";
import {
  NO_FILTERS,
  type ThreadFilters,
} from "@/client/components/orchestrator/threads";
import { type PromptInputDraft } from "@/client/components/prompt-input";
import {
  type SessionMessageDataPart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * What the thread column is narrowed to.
 *
 * Here rather than in the pane that reads it, because anything that opens a
 * brand new thread has to put the list back where that thread is visible: a
 * column standing in a topic or a place is a column the new thread is very
 * likely not in, and a button that appears to do nothing is a button someone
 * presses again.
 */
export const threadFiltersAtom = atom<ThreadFilters>(NO_FILTERS);

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
 * the window's tabs under the draft's group key; what its composer holds
 * besides the words is kept in memory beside it.
 */
export interface Draft {
  createdAt: number;
  id: string;
  /** The kind of page the response should come back as: a page-skill template, by its folder's name. */
  output?: string;
  topicId?: string;
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
export const draftsAtom = atomWithStorage<Draft[]>(
  "orchestrator.drafts.v1",
  [],
  undefined,
  { getOnInit: true },
);

/**
 * What each draft's composer held when it was last put away, by draft id:
 * the files and folders it was given, restored when the draft comes back
 * up. In memory only, since bytes do not belong in storage.
 */
export const draftSnapshotsAtom = atom<Record<string, PromptInputDraft>>({});

/** One draft being written: which draft, and how its window stands. */
export interface ComposeEntry {
  draftId: string;
  placement: ComposePlacement;
}

/** How a draft window stands: docked along the window's foot, grown to fill the window, or put down to a bar along the foot. */
export type ComposePlacement = "bar" | "docked" | "expanded";

/**
 * The drafts open in windows that float over the inbox and the thread, the
 * way a mail client keeps several compose windows along its foot, oldest
 * first: the newest stands at the right, and the ones there is no room for
 * are not drawn. In memory only: a launch opens with nothing being written,
 * and the drafts themselves are in `draftsAtom`.
 */
export const composeAtom = atom<ComposeEntry[]>([]);

/** The places the rail at the window's edge switches between: Home, the chat, and the files. */
export type AppPlace = "chat" | "files" | "home";

/**
 * The place the window stands in, chosen in the rail. The chat is the inbox
 * beside a thread and its tabs; the other two are laid out and not yet
 * built, so the window opens on the chat.
 */
export const appPlaceAtom = atomWithStorage<AppPlace>(
  "orchestrator.place.v1",
  "chat",
  undefined,
  { getOnInit: true },
);

/**
 * Whether the inbox column is shown. Put away, a thread and its tabs have
 * the window to themselves; it comes back on its own when nothing is left
 * on screen without it.
 */
export const inboxOpenAtom = atomWithStorage<boolean>(
  "orchestrator.inbox-open.v1",
  true,
  undefined,
  { getOnInit: true },
);

/**
 * Whether each group's pane is open, by the thread's session id or the
 * draft's key: the tabs beside the conversation, put away and brought back
 * by the toggle over it. A group not named here has its pane open, so a
 * thread whose agent opened something shows it on arrival.
 */
export const paneOpenByGroupAtom = atomWithStorage<Record<string, boolean>>(
  "orchestrator.pane-open.v1",
  {},
  undefined,
  { getOnInit: true },
);

/** The pane's share of the row beside the conversation, dragged at its edge; one share for every thread. */
export const orchestratorPaneShareAtom = atomWithStorage<number>(
  "orchestrator.pane-share.v1",
  TASK_PANE_DEFAULT_SHARE,
  undefined,
  { getOnInit: true },
);

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
  /** Where in `trail` the tab is standing; the end of it, until back is used. */
  at?: number;
  future?: TabVisit[];
  /**
   * The thread this tab belongs to, by its session id, or the draft's key:
   * what was opened while the thread was on screen stays with the thread.
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
 * the ones in its group, and a draft's the ones under its key. The thread
 * itself is not a tab: it stands over its tabs, and a group may have none.
 */
export const windowTabsAtom = atomWithStorage<WindowTabs>(
  "orchestrator.tabs.v8",
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
