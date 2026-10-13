import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
  type WorkspaceRPCContext,
} from "@instrument-org/workspace/electron";

import { type AppUpdaterHandle } from "../lib/create-app-updater";

export interface InitialRPCContext extends WorkspaceRPCContext {
  appUpdater: AppUpdaterHandle;
  webContentsId: number;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}
