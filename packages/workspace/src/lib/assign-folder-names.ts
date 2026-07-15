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
 * Assigns every folder in `folders` a unique, human-legible name.
 *
 * Every name is qualified with its immediate parent directory (e.g.
 * "Downloads" -> "CloudDocs-Downloads"), even without a collision, so no
 * folder's name is ever a bare guess at what it actually is. A candidate that
 * still collides walks up further ancestors, up to {@link MAX_PARENT_SEGMENTS}
 * levels, then falls back to a numeric suffix.
 *
 * Pass `folders` sorted by attach order (`createdAt`): order is the stable
 * tie-breaker once names collide past the ancestor cap, so earlier
 * attachments keep the shortest available name.
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
    const name = qualifiedName(folder.path, used);
    names.set(folder.id, name);
    used.add(name);
  }
  return names;
}

function qualifiedName(folderPath: string, used: ReadonlySet<string>): string {
  const baseName = path.basename(folderPath) || folderPath;
  let candidate = baseName;
  let dir = folderPath;
  let qualified = false;

  for (let i = 0; i < MAX_PARENT_SEGMENTS; i++) {
    const parentDir = path.dirname(dir);
    const segment = path.basename(parentDir);
    if (!segment || parentDir === dir) {
      break;
    }
    const label = segment === HOME_DIR_BASENAME ? HOME_DIR_LABEL : segment;
    candidate = `${label}-${candidate}`;
    qualified = true;
    if (!used.has(candidate)) {
      return candidate;
    }
    dir = parentDir;
  }

  // No ancestor to qualify with at all (e.g. a folder mounted at filesystem
  // root) -- fall back to the bare basename rather than an unnecessary suffix.
  if (!qualified && !used.has(candidate)) {
    return candidate;
  }

  let counter = 1;
  let suffixed = `${candidate}-${counter}`;
  while (used.has(suffixed)) {
    counter++;
    suffixed = `${candidate}-${counter}`;
  }
  return suffixed;
}
