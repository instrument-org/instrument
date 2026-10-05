import { realpathSync } from "node:fs";
import nodePath from "node:path";

/**
 * Whether paths on this machine's disks name the same file whatever their
 * case, which is the default on macOS and Windows: `.INSTRUMENT` opens the
 * `.instrument` dir there. Taken from the platform rather than probed per
 * volume, so a case-sensitive volume on a Mac compares as one that is not,
 * which only ever widens what counts as inside a folder.
 */
const CASE_INSENSITIVE =
  process.platform === "darwin" || process.platform === "win32";

/**
 * Canonical form of a path whose tail may not exist yet: resolve the deepest
 * ancestor that does, then re-attach the segments below it. Every symlink on
 * the existing part is followed, which is what makes the result safe to compare
 * against a mount root. Returns null when resolution fails for any reason other
 * than absence, so the caller can fail closed.
 */
export function canonicalizeThroughMissing(hostPath: string): null | string {
  const missing: string[] = [];
  let current = hostPath;

  for (;;) {
    try {
      return nodePath.join(realpathSync(current), ...missing.toReversed());
    } catch (error) {
      if (!isEnoent(error)) {
        return null;
      }
    }

    const parent = nodePath.dirname(current);
    if (parent === current) {
      return null;
    }
    missing.push(nodePath.basename(current));
    current = parent;
  }
}

/**
 * The part of `hostPath` under `root` as a mount-relative virtual path (`/`
 * for the root itself, `/a/b` below it), or null for a path outside it.
 * Compared without case where the disk ignores it; the part returned keeps
 * the spelling `hostPath` gave it.
 */
export function hostPathWithin(root: string, hostPath: string): null | string {
  const fold = (value: string) =>
    CASE_INSENSITIVE ? value.toLowerCase() : value;
  const resolved = nodePath.resolve(hostPath);
  const relative = nodePath.relative(
    fold(nodePath.resolve(root)),
    fold(resolved),
  );
  if (relative === "") {
    return "/";
  }
  if (
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    return null;
  }
  // As many segments of the path as it holds below the root, in the path's
  // own spelling rather than the folded one.
  const depth = relative.split(nodePath.sep).length;
  return `/${resolved.split(nodePath.sep).slice(-depth).join("/")}`;
}

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * A directory's real location: undefined where it does not exist, and null
 * where it exists and cannot be resolved, which a containment check reads as
 * unverifiable.
 */
export function realRoot(hostRoot: string): null | string | undefined {
  try {
    return realpathSync(hostRoot);
  } catch (error) {
    return isEnoent(error) ? undefined : null;
  }
}
