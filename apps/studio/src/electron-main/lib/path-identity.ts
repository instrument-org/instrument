import fs from "node:fs";
import path from "node:path";

/**
 * Whether two spellings name one folder, for the registry of workspaces and
 * the checks on a folder the person picks: links resolved, and names that
 * differ only in case taken as one where the volume holding them ignores
 * case, as the volumes macOS and Windows make by default do. For comparing,
 * never for opening.
 */

/** Whether `a` and `b` name the same folder. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Whether `inner` is `outer` or inside it. */
export function pathWithin(inner: string, outer: string): boolean {
  const relative = path.relative(pathKey(outer), pathKey(inner));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * A path as its volume knows it: absolute, its links resolved as far as it
 * exists (a part not made yet is taken as spelled), and lowercased where
 * that volume ignores case.
 */
export function pathKey(spelled: string): string {
  const resolved = path.resolve(spelled);
  const missing: string[] = [];
  let existing = resolved;
  let real: string | undefined;
  for (;;) {
    try {
      real = fs.realpathSync.native(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) {
        break;
      }
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const canonical = path.join(real ?? existing, ...missing);
  return real !== undefined && ignoresCase(real)
    ? canonical.toLowerCase()
    : canonical;
}

/** Whether a volume ignores case, by its device, asked once. */
const foldsByDevice = new Map<number, boolean>();

/**
 * Whether the volume holding `existing` (a path that exists, links resolved)
 * ignores case: whether its last name that has a case, spelled in the other
 * one, finds the same entry. A path with no such name, such as a volume's
 * root, goes by what the system's own volumes do.
 */
function ignoresCase(existing: string): boolean {
  let probe = existing;
  while (flipCase(path.basename(probe)) === path.basename(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      return systemFoldsCase();
    }
    probe = parent;
  }
  const folder = path.dirname(probe);
  let device: number;
  try {
    device = fs.statSync(folder).dev;
  } catch {
    return systemFoldsCase();
  }
  const known = foldsByDevice.get(device);
  if (known !== undefined) {
    return known;
  }
  let folds: boolean;
  try {
    const original = fs.statSync(probe);
    const other = fs.statSync(
      path.join(folder, flipCase(path.basename(probe))),
    );
    folds = original.ino === other.ino && original.dev === other.dev;
  } catch {
    folds = false;
  }
  foldsByDevice.set(device, folds);
  return folds;
}

function flipCase(name: string) {
  return name.replaceAll(/\p{L}/gu, (char) =>
    char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase(),
  );
}

function systemFoldsCase() {
  return process.platform === "darwin" || process.platform === "win32";
}
