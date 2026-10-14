import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getWorkspaceConfig, hasWorkspaceConfig } from "../workspace-config";

/** Creates the output folder if it is not there yet. */
export async function ensureOutputFolder(): Promise<void> {
  await fs.mkdir(outputFolderPath(), { recursive: true });
}

/**
 * `Instrument` in the person's Documents: where finished work goes while the
 * workspace is kept in the app's own data, and the folder suggested when the
 * person picks where to keep their Instrument folder.
 */
export function instrumentFolderInDocuments(): string {
  return path.join(os.homedir(), "Documents", "Instrument");
}

/**
 * Where everything Instrument makes lands when nobody said where, created on
 * first use and reached by every chat (see folder-reach.ts), so a task can be
 * handed it like any other folder and the user can find it in the Finder
 * like any other folder: the workspace's own folder once the person picked
 * one (the config's `outputDir`), and otherwise
 * {@link instrumentFolderInDocuments}.
 */
export function outputFolderPath(): string {
  return (
    (hasWorkspaceConfig() ? getWorkspaceConfig().outputDir : undefined) ??
    instrumentFolderInDocuments()
  );
}
