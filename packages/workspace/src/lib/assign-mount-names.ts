import { folderNameFromPath } from "@instrument-org/shared";
import os from "node:os";
import path from "node:path";

// How many ancestor directory names to fold into a candidate before giving up
// and falling back to a numeric suffix.
const MAX_PARENT_SEGMENTS = 3;

// The OS username segment of the home directory is real PII (it ends up in
// agent context, session markdown exports, and shared task transcripts), so
// it's replaced with this generic label rather than shown verbatim.
const HOME_DIR_BASENAME = path.basename(os.homedir());
const HOME_DIR_LABEL = "Home";

/**
 * Assigns every folder in `folders` the name it is mounted under, unique within
 * the task.
 *
 * This is the agent's handle for a folder, not the user's word for it: it ends
 * up as the `/mnt/<name>` path the model reads and writes through. A folder
 * mounts under its own name where it can, and takes an ancestor only when
 * another folder in the same task already holds that name ("Documents-test"
 * beside "test"). A candidate that still collides walks up further ancestors,
 * up to {@link MAX_PARENT_SEGMENTS} levels, then falls back to a numeric suffix.
 *
 * Qualifying unconditionally reads as a rename to the person who attached the
 * folder, because the model quotes this name back to them: `~/Documents/test`
 * reached the user as "the documents-test folder". The disambiguation is worth
 * that cost only where two folders genuinely cannot be told apart, and even
 * there the model is given a name and a parent to say instead (see
 * build-attached-folders-text.ts).
 *
 * Pass `folders` sorted by attach order (`createdAt`): order is the stable
 * tie-breaker, so the earliest attachment keeps the bare name and later
 * namesakes take the qualified ones.
 *
 * Callers must re-derive every name here on any attach, not just the new
 * folder's -- attaching one folder can, rarely, force an already-attached
 * folder to mount elsewhere to stay distinguishable from it.
 */
export function assignMountNames(
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

function uniqueName(folderPath: string, used: ReadonlySet<string>): string {
  const baseName = folderNameFromPath(folderPath);
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
