import { type ChosenItem } from "@/client/atoms/orchestrator";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
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
  /** With `newTab`, the tab waits behind the one up, as a middle-click's does in a browser. */
  behind?: boolean;
  group?: string;
  /**
   * A tab of the window's own, across its bar, wherever it was asked for
   * from: what a middle click, a Cmd-click, or Open in New Tab asks.
   */
  newTab?: boolean;
  /** A tab of its own in the group, beside the one up rather than in its place: what a conversation or an agent opens. */
  ownTab?: boolean;
  /** Takes the place of the address the window's tab stands on rather than stepping on from it: a screen handing its file to the page. */
  replace?: boolean;
  show?: boolean;
}

/** What every screen of the orchestrator window shares. */
export interface OrchestratorWindow {
  /** Opens a draft of a new chat with the line already in it, to be read and sent by the person; inside a chat, sends the line there. */
  ask: (prompt: string) => void;
  /**
   * Opens a draft of a new chat with these files or folders picked to go
   * with it; absent where there is no new draft to open, as inside one.
   */
  askAbout?: (items: ChosenItem[]) => void;
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserTabsHandle | null;
  /** Puts the caret in the conversation's composer, for a screen handing something over to be asked about. */
  focusComposer: () => void;
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
  /** The tail of the tab's row, where a screen draws what it can do with what it shows; null until the row is up. */
  rowTail?: HTMLElement | null;
  /** The chat a surface is drawn inside, when it is one; absent at the top level, where `ask` opens a draft. */
  sessionId?: StoreId.Session;
  taskId: TaskId;
}

export const OrchestratorContext = createContext<null | OrchestratorWindow>(
  null,
);

export function useOrchestrator(): OrchestratorWindow {
  const value = useContext(OrchestratorContext);
  if (!value) {
    throw new Error(
      "useOrchestrator is only for screens of the orchestrator window",
    );
  }
  return value;
}
