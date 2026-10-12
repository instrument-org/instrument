import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

const WINDOW_FOLDER_NAME = "window";

/**
 * The window's own folder, `.instrument/window/` at the workspace root,
 * standing where a chat's folder stands for what is scoped to the window
 * (its tabs' pages are kept in the store inside it).
 */
export function windowDir(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return absolutePathJoin(rootDir, PRIVATE_FOLDER_NAME, WINDOW_FOLDER_NAME);
}

/** Makes the window's folder, which its tabs' store opens inside. */
export async function ensureWindowDir(): Promise<void> {
  await fs.mkdir(windowDir(), { recursive: true });
}
