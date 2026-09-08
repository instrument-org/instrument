import {
  folderLabelFromPath,
  HOME_DIR_LABEL,
  parentSegmentFromPath,
} from "@instrument-org/shared";
import os from "node:os";
import path from "node:path";

// The account name, as a path segment, for the ancestor case: this side knows
// the home directory, which is what the pure helpers cannot.
const HOME_DIR_BASENAME = path.basename(os.homedir());

/**
 * What a folder is called where the agent is told about it, and so what it
 * calls the folder back to the user. The rule is the renderer's rule (see
 * folder-paths.ts in the shared package); what this side adds is the home
 * directory it is read against.
 *
 * The name the folder is mounted under agrees with this wherever it can
 * (assign-mount-names.ts), and parts from it where two folders in one task
 * share a name and only one of them can keep it.
 */
export function folderLabel(folderPath: string): string {
  return folderLabelFromPath(folderPath, os.homedir());
}

/**
 * The folder one level up, named for a reader rather than for a filesystem: the
 * home directory answers "Home" instead of the account name it is really
 * called. Undefined at a filesystem root, where there is nothing to point at.
 *
 * Its own module because of that substitution, which needs `node:os` and so
 * cannot sit beside the pure path helpers the renderer also reaches.
 */
export function folderParentLabel(folderPath: string): string | undefined {
  const segment = parentSegmentFromPath(folderPath);
  if (segment === undefined) {
    return undefined;
  }
  return segment === HOME_DIR_BASENAME ? HOME_DIR_LABEL : segment;
}
