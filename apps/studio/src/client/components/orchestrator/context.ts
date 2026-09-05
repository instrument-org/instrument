import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type BrowserViewHandle } from "./browser-view";

/** What every screen of the orchestrator window shares. */
export interface OrchestratorWindow {
  /** The window's browser, mounted once by the layout and kept across screens; null until it is. */
  browser: BrowserViewHandle | null;
  /** The virtual path of the folder outcomes land in by default. */
  outputFolder: string;
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
