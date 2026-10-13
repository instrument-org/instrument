import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * This computer's own folder for the workspace
 * (`WorkspaceConfig.workspaceMachineDir`), or where none is given (tests,
 * scripts) the workspace's private `.instrument/`, which the agent never
 * reaches either.
 */
export function workspaceMachineDir(): AbsolutePath {
  const { rootDir, workspaceMachineDir: given } = getWorkspaceConfig();
  return given ?? absolutePathJoin(rootDir, PRIVATE_FOLDER_NAME);
}
