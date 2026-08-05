import { parentSegmentFromPath } from "@instrument-org/shared";
import os from "node:os";
import path from "node:path";

// The OS username segment of the home directory is real PII (it ends up in
// agent context, session markdown exports, and shared task transcripts), so
// it's replaced with this generic label rather than shown verbatim.
const HOME_DIR_BASENAME = path.basename(os.homedir());
const HOME_DIR_LABEL = "Home";

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
