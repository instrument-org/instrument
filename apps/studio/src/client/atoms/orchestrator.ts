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
 * Where a tab has been, and whether it was opened by something else.
 *
 * History belongs to a tab rather than to the window: back never moves you to
 * a different tab, which is the thing that makes a strip of them readable. A
 * page tab keeps its guest's own history instead of a trail, since the guest
 * is already the thing that remembers.
 */
export interface TabHistory {
  /** Where in `trail` the tab is standing; the end of it, until back is used. */
  at?: number;
  /**
   * True when this tab was opened from another one rather than by the user
   * asking for a tab. Back from the start of such a tab closes it, which is
   * what a tab opened to show one thing should do when you are done with it.
   */
  isOpened?: boolean;
  /** The screen addresses this tab has been at, oldest first. */
  trail?: string[];
}

/**
 * A tab of the window. A page is a browser session of the orchestrator's,
 * drawn by a guest the pool holds; a screen is anything else the product
 * shows (a folder, a file, a task, the apps, a new tab), addressed by the
 * route it is at, so navigating inside it changes the tab and not the row.
 */
export type WindowTab = TabHistory &
  (
    | (BrowserTab & { kind: "page" })
    | { href: string; id: string; kind: "screen" }
  );

/** The address a new tab opens at: the page with the box that reaches everything. */
export const NEW_TAB_HREF = "/orchestrator/home";

/** What one channel has open: its tabs in strip order, and which is on screen. */
export interface ChannelTabs {
  activeId: null | string;
  tabs: WindowTab[];
}

const NO_TABS: ChannelTabs = { activeId: null, tabs: [] };

/**
 * Every channel's tabs, by channel id, kept across launches.
 *
 * A channel owns what is open in the window while it is the one on the rail:
 * switching channels swaps the whole strip and the page on screen, and the
 * guests of the channels not on screen stay attached, so a task can carry on
 * browsing in a channel the user is not looking at.
 */
export const windowTabsByChannelAtom = atomWithStorage<
  Record<string, ChannelTabs>
>("orchestrator.tabs.v2", {}, undefined, { getOnInit: true });

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

/**
 * The tabs of the channel on screen. Every screen reads and writes this one
 * and never knows which channel it belongs to; the channel is what the write
 * is keyed by.
 */
export const windowTabsAtom = atom(
  (get) =>
    get(windowTabsByChannelAtom)[get(selectedChannelAtom) ?? ""] ?? NO_TABS,
  (get, set, update: ((current: ChannelTabs) => ChannelTabs) | ChannelTabs) => {
    const channel = get(selectedChannelAtom) ?? "";
    set(windowTabsByChannelAtom, (byChannel) => ({
      ...byChannel,
      [channel]:
        typeof update === "function"
          ? update(byChannel[channel] ?? NO_TABS)
          : update,
    }));
  },
);

/** Writes a named channel's tabs, for what arrives on a channel other than the one on screen. */
export const channelTabsAtom = atom(
  null,
  (
    _get,
    set,
    channel: string,
    update: ((current: ChannelTabs) => ChannelTabs) | ChannelTabs,
  ) => {
    set(windowTabsByChannelAtom, (byChannel) => ({
      ...byChannel,
      [channel]:
        typeof update === "function"
          ? update(byChannel[channel] ?? NO_TABS)
          : update,
    }));
  },
);

/** Every tab id the window holds, across every channel, so nothing is opened twice. */
export const everyTabIdAtom = atom(
  (get) =>
    new Set(
      Object.values(get(windowTabsByChannelAtom)).flatMap((channel) =>
        channel.tabs.map((tab) => tab.id),
      ),
    ),
);
