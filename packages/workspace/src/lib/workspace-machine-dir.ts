import { type AbsolutePath } from "../schemas/paths";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * This computer's own folder for the workspace
 * (`WorkspaceConfig.workspaceMachineDir`).
 */
export function workspaceMachineDir(): AbsolutePath {
  return getWorkspaceConfig().workspaceMachineDir;
}
