import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getWorkspaceConfig, hasWorkspaceConfig } from "../workspace-config";

/** Creates the workspace folder if it is not there yet. */
export async function ensureOutputFolder(): Promise<void> {
  await fs.mkdir(outputFolderPath(), { recursive: true });
}

/**
 * Where everything Instrument makes lands when nobody said where: a folder in
 * the user's Documents unless they chose another place for it during setup,
 * created on first use and reached by every chat (see folder-reach.ts), so a
 * task can be handed it like any other folder and the user can find it in the
 * Finder like any other folder.
 */
export function outputFolderPath(): string {
  const chosen = hasWorkspaceConfig()
    ? getWorkspaceConfig().outputFolder?.chosenPath()
    : undefined;
  return chosen ?? defaultOutputFolderPath();
}

/** The output folder's place when the person has not chosen one. */
export function defaultOutputFolderPath(): string {
  return path.join(os.homedir(), "Documents", "Instrument");
}

/** Whether making the output folder waits, for setup to say where it goes. */
export function isOutputFolderHeld(): boolean {
  return hasWorkspaceConfig()
    ? (getWorkspaceConfig().outputFolder?.isHeld() ?? false)
    : false;
}
