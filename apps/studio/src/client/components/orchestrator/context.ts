import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";

/** What every screen of the orchestrator window shares. */
export interface OrchestratorWindow {
  /** Sends a line to the conversation, as typing it would, and shows the conversation. */
  ask: (prompt: string) => void;
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserTabsHandle | null;
  /** Shows the page at that address in a tab: the one already there, or a new one. A fresh new tab it was picked from becomes it. */
  openPage: (url: string) => void;
  /** Shows a screen at that address in a tab: the one already there, or a new one. A fresh new tab it was picked from becomes it. */
  openScreen: (href: string) => void;
  sessionId: StoreId.Session;
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
