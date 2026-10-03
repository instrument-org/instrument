import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Creates the workspace folder if it is not there yet. */
export async function ensureOutputFolder(): Promise<void> {
  await fs.mkdir(outputFolderPath(), { recursive: true });
}

/**
 * Where everything Instrument makes lands when nobody said where: a folder in
 * the user's Documents, created on first use and reached by every chat (see
 * folder-reach.ts), so a task can be handed it like any other folder and the
 * user can find it in the Finder like any other folder.
 */
export function outputFolderPath(): string {
  return path.join(os.homedir(), "Documents", "Instrument");
}
