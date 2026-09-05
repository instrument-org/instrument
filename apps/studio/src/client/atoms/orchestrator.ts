import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** A screen the window was on, so the sidebar can take the user back to it. */
export interface OrchestratorRecent {
  at: number;
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
 * What the Computer screen last had on screen, kept after the user moves to
 * another screen: "this folder" in the conversation means the folder they were
 * looking at, whichever screen is up when they say it.
 */
export interface ComputerView {
  /** The folder as a person writes it: `~/Documents`. */
  folder: string;
  hostPath: string;
  /** How the agent reaches it, when a granted folder covers it. */
  mount?: string;
  /** Names selected in it. */
  selected: string[];
}

export const computerViewAtom = atom<ComputerView | null>(null);

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
  /** The session id, which is the half of the target id a task can be handed. */
  id: string;
  openedAt: number;
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
  "orchestrator.browser-tabs.v1",
  { activeId: null, tabs: [] },
  undefined,
  { getOnInit: true },
);
