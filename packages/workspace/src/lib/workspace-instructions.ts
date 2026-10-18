import fs from "node:fs/promises";
import path from "node:path";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { instructionsInContext } from "./instructions-in-context";
import { getWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * Only the workspace root's AGENTS.md applies to every chat and task. Its
 * bounded contents travel on each new message so edits, removal, forks, and
 * rollover are interpreted from the snapshot rather than live disk reads.
 */
export async function readWorkspaceInstructions(): Promise<
  SessionMessageDataPart.WorkspaceInstructionsDataPart | undefined
> {
  const config = getWorkspaceConfig();
  const hostFile = path.join(config.rootDir, "AGENTS.md");
  const file = shellPath(hostFile);
  try {
    const instructions = instructionsInContext({
      file,
      instructions: await fs.readFile(hostFile, "utf8"),
    });
    return { file, ...(instructions ? { instructions } : {}) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { file };
    }
    // Failure to read is not evidence that earlier instructions were removed.
    config.captureException(error);
    return undefined;
  }
}
