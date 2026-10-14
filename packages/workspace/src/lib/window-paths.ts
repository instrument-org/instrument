import fs from "node:fs/promises";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { getWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

/**
 * The window's own record folder, `.instrument/window/` in the workspace,
 * standing where a chat's record folder stands for what is scoped to the
 * window (its tabs' pages are kept in the `chat.db` inside it).
 */
export function windowDir(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return AbsolutePathSchema.parse(workspaceLayout(rootDir).windowDir);
}

/** Makes the window's folder, which its tabs' store opens inside. */
export async function ensureWindowDir(): Promise<void> {
  await fs.mkdir(windowDir(), { recursive: true });
}
