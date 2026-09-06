import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
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
  "orchestrator.recents.v1",
  [],
  undefined,
  { getOnInit: true },
);

/** Its own key: this window's sidebar opens and closes apart from Studio's. */
export const orchestratorSidebarOpenAtom = atomWithStorage<boolean>(
  "orchestrator.sidebar-open.v1",
  true,
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

/** Whether the conversation down the right is open. */
export const orchestratorChatOpenAtom = atomWithStorage<boolean>(
  "orchestrator.chat-open.v1",
  true,
  undefined,
  { getOnInit: true },
);

export const CHAT_WIDTH_MIN = 320;
export const CHAT_WIDTH_MAX = 800;
export const CHAT_WIDTH_DEFAULT = 480;

/** The conversation's width in CSS px, dragged by its left edge. */
export const orchestratorChatWidthAtom = atomWithStorage<number>(
  "orchestrator.chat-width.v1",
  CHAT_WIDTH_DEFAULT,
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
  /** The page's title, as it last announced it; kept so a tab not yet shown still says what it is. */
  title?: string;
  /** The last page it showed, opened again when the tab comes back. */
  url?: string;
}

export interface BrowserTabs {
  activeId: null | string;
  tabs: BrowserTab[];
}

export function clampChatWidth(value: number) {
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(value)));
}

/**
 * The window's tabs, kept across launches: each is a browser session whose
 * last page the workspace restores when the tab is opened again.
 */
export const orchestratorTabsAtom = atomWithStorage<BrowserTabs>(
  "orchestrator.browser-tabs.v2",
  { activeId: null, tabs: [] },
  undefined,
  { getOnInit: true },
);

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

/** A file open in a tab of This Mac, beside the folder browser. */
export interface FileTab {
  /** Where it is on the Mac, when known: as the person writes it. */
  hostPath?: string;
  /** The virtual path the viewer and the agent reach it by; the tab's identity. */
  mount: string;
  name: string;
}

/** File tabs closed this launch, newest last, for Shift+Cmd+T. */
export const closedFileTabsAtom = atom<FileTab[]>([]);

export const TASKS_COLUMN_MIN = 200;
export const TASKS_COLUMN_MAX = 480;

/** The Tasks screen's list column width in CSS px, dragged by its right edge. */
export const tasksColumnWidthAtom = atomWithStorage<number>(
  "orchestrator.tasks-column-width.v1",
  288,
  undefined,
  { getOnInit: true },
);

/** The files open on This Mac, in strip order, kept across launches. */
export const fileTabsAtom = atomWithStorage<FileTab[]>(
  "orchestrator.file-tabs.v1",
  [],
  undefined,
  { getOnInit: true },
);
