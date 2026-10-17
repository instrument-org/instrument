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
export function canonicalizeThroughMissing(
  hostPath: string,
  realpath: (existing: string) => string = realpathSync,
): null | string {
  const missing: string[] = [];
  let current = hostPath;

  for (;;) {
    try {
      return nodePath.join(realpath(current), ...missing.toReversed());
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
 * The part of `hostPath` under `root` as a root-relative path (`/`
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

/**
 * A path on macOS's Data volume as the rest of the system spells it. The
 * volume is joined to `/` by firmlinks, which `realpath` leaves alone, so
 * `/System/Volumes/Data/Users/sam/.ssh` is `~/.ssh` by another name and has
 * to meet the same rules. Seatbelt matches the path the kernel resolved and
 * needs no help.
 */
export function withoutDataVolume(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "darwin") {
    return hostPath;
  }
  const match = /^\/System\/Volumes\/Data(?=\/|$)/i.exec(hostPath);
  return match ? hostPath.slice(match[0].length) || "/" : hostPath;
}

/**
 * A path as Windows opens it: each name without the dots and spaces that end
 * it, which Windows drops, so `.instrument.` and `.instrument ` open
 * `.instrument`. A name made only of dots (`..`) is left as it is. Other
 * systems keep those characters, and the path is returned as given there.
 */
export function withoutTrailingDots(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? hostPath.replaceAll(/(?<=[^/\\. ])[. ]+(?=[/\\]|$)/g, "")
    : hostPath;
}

/**
 * Whether a path names a file or folder through one of its NTFS streams:
 * on Windows a `:` after the drive is never part of a name, only what
 * separates one from a stream (`.instrument::$INDEX_ALLOCATION` opens the
 * `.instrument` folder). Nothing elsewhere, where `:` is a character a
 * name may hold.
 */
export function namesStream(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" &&
    hostPath.replace(/^(?:[\\/]{2}[?.][\\/])?(?:[A-Za-z]:)?/, "").includes(":")
  );
}

/**
 * A path as Windows opens it, which can differ from its spelling by more
 * than case: an 8.3 short name (`INSTRU~1`) opens the folder its long name
 * does. The system resolves the deepest part that exists
 * (`realpathSync.native`), and the rest is kept as spelled. The path as given
 * elsewhere, and where the system cannot resolve it.
 */
export function windowsOpenedPath(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return hostPath;
  }
  return (
    canonicalizeThroughMissing(hostPath, (existing) =>
      realpathSync.native(existing),
    ) ?? hostPath
  );
}

/**
 * A path without the backslashes a shell escapes characters with, which a
 * word expanded wrongly can leave in it (`Instrument Preview \(x\)` for
 * `Instrument Preview (x)`). Windows keeps them, as they separate its
 * folders there.
 */
export function withoutShellEscapes(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? hostPath : hostPath.replaceAll(/\\(.)/gs, "$1");
}

/**
 * Where a path really is, as the rules compare paths: absolute, every link
 * on the way followed (through a tail that does not exist yet), on macOS off
 * the Data volume, and on Windows without the dots and spaces that end a
 * name. The path as given, made absolute, where it cannot be resolved, which
 * is also where the system cannot follow it.
 */
export function realHostPath(hostPath: string): string {
  const resolved = nodePath.resolve(hostPath);
  return withoutTrailingDots(
    withoutDataVolume(canonicalizeThroughMissing(resolved) ?? resolved),
  );
}

function isEnoent(error: unknown): boolean {
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
