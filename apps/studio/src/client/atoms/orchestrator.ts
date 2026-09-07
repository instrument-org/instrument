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
  "orchestrator.recents.v2",
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

/** A file the conversation has put on screen, newest first: what the sidebar lists as recent. */
export interface LinkedFile {
  name: string;
  /** The virtual path the reply named. */
  path: string;
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

export const linkedFilesAtom = atom<LinkedFile[]>([]);

/** A file the window can open in a tab: where the viewer reaches it, and where it is on the Mac when known. */
export interface FileTab {
  /** Where it is on the Mac, when known: as the person writes it. */
  hostPath?: string;
  /** The virtual path the viewer and the agent reach it by; the tab's identity. */
  mount: string;
  name: string;
}

export const TASKS_COLUMN_MIN = 200;
export const TASKS_COLUMN_MAX = 480;

/** The Tasks screen's list column width in CSS px, dragged by its right edge. */
export const tasksColumnWidthAtom = atomWithStorage<number>(
  "orchestrator.tasks-column-width.v1",
  288,
  undefined,
  { getOnInit: true },
);

/**
 * A tab of the window. A page is a browser session of the orchestrator's,
 * drawn by a guest the pool holds; a screen is anything else the product
 * shows (a folder, a file, a task, the apps, a new tab), addressed by the
 * route it is at, so navigating inside it changes the tab and not the row.
 */
export type WindowTab =
  | (BrowserTab & { kind: "page" })
  | { href: string; id: string; kind: "screen" };

/** The address a new tab opens at: the page with the box that reaches everything. */
export const NEW_TAB_HREF = "/orchestrator/home";

/** The window's tabs in strip order and which is on screen, kept across launches. */
export const windowTabsAtom = atomWithStorage<{
  activeId: null | string;
  tabs: WindowTab[];
}>("orchestrator.tabs.v1", { activeId: null, tabs: [] }, undefined, {
  getOnInit: true,
});

/** Tabs closed this launch, newest last, for Shift+Cmd+T. A page comes back at its last address. */
export const closedTabsAtom = atom<WindowTab[]>([]);

export const SIDEBAR_WIDTH_MIN = 320;
export const SIDEBAR_WIDTH_MAX = 640;
export const SIDEBAR_WIDTH_DEFAULT = 400;

/** The sidebar's width in CSS px, dragged by its right edge. It holds the conversation, so it never closes. */
export const orchestratorSidebarWidthAtom = atomWithStorage<number>(
  "orchestrator.sidebar-width.v1",
  SIDEBAR_WIDTH_DEFAULT,
  undefined,
  { getOnInit: true },
);

/** Whether the sidebar is open, or shrunk to a rail. It is never gone: the rail keeps the conversation one click away. */
export const orchestratorSidebarOpenAtom = atomWithStorage<boolean>(
  "orchestrator.sidebar-open.v2",
  true,
  undefined,
  { getOnInit: true },
);

export const PINS_HEIGHT_MIN = 40;
export const PINS_HEIGHT_DEFAULT = 96;

/** The height of the pinned area above the conversation, in CSS px, dragged by the divider under it. */
export const orchestratorPinsHeightAtom = atomWithStorage<number>(
  "orchestrator.pins-height.v1",
  PINS_HEIGHT_DEFAULT,
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

/**
 * The channel the conversation is showing, by its session id.
 *
 * Kept here rather than in the route so the strip and the composer agree
 * without threading it through the screens, and remembered across launches so
 * the window opens where the user left off. An id that no longer names a
 * channel falls back to the first one.
 */
export const selectedChannelAtom = atomWithStorage<null | string>(
  "orchestrator.channel.v1",
  null,
  undefined,
  { getOnInit: true },
);
