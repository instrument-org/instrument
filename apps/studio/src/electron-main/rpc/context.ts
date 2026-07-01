import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
  type WorkspaceRPCContext,
} from "@instrument-org/workspace/electron";

import { type BrowserViewManager } from "../browser-view/manager";
import { type AppUpdatesService } from "../lib/app-updates";
import { type StudioAppUpdater } from "../lib/update";

export interface InitialRPCContext extends WorkspaceRPCContext {
  appUpdater: StudioAppUpdater;
  appUpdates: AppUpdatesService;
  browserViewManager: BrowserViewManager;
  webContentsId: number;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}
