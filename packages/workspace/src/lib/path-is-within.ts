import path from "node:path";

/**
 * True when `candidate` is `root` itself or a descendant of it.
 *
 * Uses a path-boundary check so a sibling that merely shares a string prefix
 * (e.g. `/foo/barista` vs `/foo/bar`) is not mistaken for being inside `root`.
 * Inputs are treated as already-normalized absolute host paths.
 */
export function pathIsWithin(candidate: string, root: string): boolean {
  if (candidate === root) {
    return true;
  }
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(rootWithSep);
}
