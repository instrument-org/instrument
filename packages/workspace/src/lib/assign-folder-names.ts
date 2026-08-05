import os from "node:os";
import path from "node:path";

import { folderParentSegment } from "./folder-display-name";

// How many ancestor directory names to fold into a candidate before giving up
// and falling back to a numeric suffix.
const MAX_PARENT_SEGMENTS = 3;

// The OS username segment of the home directory is real PII (it ends up in
// agent context, session markdown exports, and shared task transcripts), so
// it's replaced with this generic label rather than shown verbatim.
const HOME_DIR_BASENAME = path.basename(os.homedir());
const HOME_DIR_LABEL = "Home";

/**
 * Assigns every folder in `folders` a unique, human-legible name.
 *
 * A folder keeps the name the user knows it by -- its own basename -- and is
 * qualified with an ancestor only when another folder in the same task already
 * holds that name ("Documents-test" beside "test"). A candidate that still
 * collides walks up further ancestors, up to {@link MAX_PARENT_SEGMENTS}
 * levels, then falls back to a numeric suffix.
 *
 * Qualifying unconditionally reads as a rename to the person who attached the
 * folder: the name is the mount path, so the agent quotes it back as the
 * folder's name, and `~/Documents/test` reaches the user as "the documents-test
 * folder". The disambiguation is worth that cost only where two folders
 * genuinely cannot be told apart, and even there the agent is given a name and
 * a parent to speak instead (see build-attached-folders-text.ts).
 *
 * Pass `folders` sorted by attach order (`createdAt`): order is the stable
 * tie-breaker, so the earliest attachment keeps the bare name and later
 * namesakes take the qualified ones.
 *
 * Callers must re-derive every folder's name here on any attach, not just the
 * new folder's -- attaching one folder can, rarely, force an already-attached
 * folder's name to change to stay distinguishable from it.
 */
export function assignFolderNames(
  folders: { id: string; path: string }[],
): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const folder of folders) {
    const name = uniqueName(folder.path, used);
    names.set(folder.id, name);
    used.add(name);
  }
  return names;
}

/**
 * {@link folderParentSegment}, with the home directory's real name swapped for
 * a generic one. Lives here rather than beside the pure helper because reading
 * the home directory needs `node:os`, which the client bundle cannot have.
 */
export function folderParentLabel(folderPath: string): string | undefined {
  const segment = folderParentSegment(folderPath);
  if (segment === undefined) {
    return undefined;
  }
  return segment === HOME_DIR_BASENAME ? HOME_DIR_LABEL : segment;
}

function uniqueName(folderPath: string, used: ReadonlySet<string>): string {
  const baseName = path.basename(folderPath) || folderPath;
  if (!used.has(baseName)) {
    return baseName;
  }

  let candidate = baseName;
  let dir = folderPath;

  for (let i = 0; i < MAX_PARENT_SEGMENTS; i++) {
    const parentDir = path.dirname(dir);
    const segment = path.basename(parentDir);
    if (!segment || parentDir === dir) {
      break;
    }
    const label = segment === HOME_DIR_BASENAME ? HOME_DIR_LABEL : segment;
    candidate = `${label}-${candidate}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    dir = parentDir;
  }

  let counter = 1;
  let suffixed = `${candidate}-${counter}`;
  while (used.has(suffixed)) {
    counter++;
    suffixed = `${candidate}-${counter}`;
  }
  return suffixed;
}
