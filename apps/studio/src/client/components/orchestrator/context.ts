import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";

/** What every screen of the orchestrator window shares. */
export interface OrchestratorWindow {
  /** Sends a line at the top level of the chat, as typing it would, which opens a thread with it. */
  ask: (prompt: string) => void;
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserTabsHandle | null;
  /** Puts the caret in the conversation's composer, for a screen handing something over to be asked about. */
  focusComposer: () => void;
  /** Navigates this surface's tab; conversation surfaces open another tab. */
  openPage: (url: string, options?: { newTab?: boolean }) => void;
  /** Navigates this surface's tab; conversation surfaces open another tab. */
  openScreen: (href: string, options?: { newTab?: boolean }) => void;
  /**
   * Whether the openers above already land in a tab of their own.
   *
   * The conversation is beside the tabs rather than in one, so what it opens
   * has nowhere in place to go. A surface that says so here is one where a
   * link has no second destination left to offer.
   */
  opensNewTab?: boolean;
  /** The thread a surface is drawn inside, when it is one; absent at the top level, where `ask` opens a new thread. */
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
