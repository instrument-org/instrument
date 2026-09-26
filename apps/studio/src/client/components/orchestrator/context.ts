import { type ChosenItem } from "@/client/atoms/orchestrator";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";

/**
 * What an opener is told: a tab of its own; the group the thing belongs to,
 * when not the one on screen; and whether to bring that group on screen at
 * it, for what the user asked for by name rather than what an agent opened
 * behind.
 */
export interface OpenOptions {
  group?: string;
  newTab?: boolean;
  show?: boolean;
}

/** What every screen of the orchestrator window shares. */
export interface OrchestratorWindow {
  /** Opens a draft of a new thread with the line already in it, to be read and sent by the person; inside a thread, sends the line there. */
  ask: (prompt: string) => void;
  /**
   * Opens a draft of a new thread with these files or folders picked to go
   * with it, and words already in it when given; absent where there is no
   * new draft to open, as inside one.
   */
  askAbout?: (items: ChosenItem[], words?: string) => void;
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserTabsHandle | null;
  /** Puts the caret in the conversation's composer, for a screen handing something over to be asked about. */
  focusComposer: () => void;
  /** Navigates this surface's tab; conversation surfaces open another tab. */
  openPage: (url: string, options?: OpenOptions) => void;
  /** Opens a path the conversation named: a file in its viewer, a folder as the folder view standing in it. */
  openPath: (path: string, options?: OpenOptions) => void;
  /** Navigates this surface's tab; conversation surfaces open another tab. */
  openScreen: (href: string, options?: OpenOptions) => void;
  /**
   * Whether the openers above already land in a tab of their own.
   *
   * The conversation is beside the tabs rather than in one, so what it opens
   * has nowhere in place to go. A surface that says so here is one where a
   * link has no second destination left to offer.
   */
  opensNewTab?: boolean;
  /** The head of the tab's row, ahead of back and forward, where a screen draws the toggle for a panel along its left edge; null until the row is up. */
  rowLead?: HTMLElement | null;
  /** The tail of the tab's row, where a screen draws what it can do with what it shows; null until the row is up. */
  rowTail?: HTMLElement | null;
  /** The thread a surface is drawn inside, when it is one; absent at the top level, where `ask` opens a draft. */
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
