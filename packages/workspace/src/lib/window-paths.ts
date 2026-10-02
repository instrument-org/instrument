import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

const WINDOW_STATE_FILE_NAME = "window.json";
const WINDOW_FOLDER_NAME = "window";

/**
 * The window's own folder, `.instrument/window/` at the workspace root,
 * standing where a chat's folder stands for what is scoped to the window
 * (its tabs' pages are kept in the store inside it).
 */
export function windowDir(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return absolutePathJoin(
    rootDir,
    TASK_PRIVATE_FOLDER_NAME,
    WINDOW_FOLDER_NAME,
  );
}

/** Where the window's state is kept. */
export function windowStatePath(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return absolutePathJoin(
    rootDir,
    TASK_PRIVATE_FOLDER_NAME,
    WINDOW_STATE_FILE_NAME,
  );
}
