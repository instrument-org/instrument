import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
  type WorkspaceRPCContext,
} from "@instrument-org/workspace/electron";

import { type BrowserViewManager } from "../lib/browser-view-manager/manager";
import { type StudioAppUpdater } from "../lib/update";

export interface InitialRPCContext extends WorkspaceRPCContext {
  appUpdater: StudioAppUpdater;
  browserViewManager: BrowserViewManager;
  webContentsId: number;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}
