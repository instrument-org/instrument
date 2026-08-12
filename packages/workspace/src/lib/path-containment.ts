/**
 * Is one virtual path at or inside another, and what is the remainder.
 *
 * Written once because the spelling has three ways to be wrong and none of
 * them announces itself. Compare with `===` alone and the root itself stops
 * matching; compare with `startsWith` and no trailing slash and `/tasks`
 * matches `/task`; and whether the root counts as contained differs by caller,
 * so the two questions are named apart rather than left to whichever one the
 * next reader assumes. What follows the root is the remainder, whose leading
 * slash one caller keeps to build a URL and another drops to build a
 * task-relative path -- an off-by-one that reads as a typo either way round.
 *
 * The root is usually a mount point, but the private dir under the task mount
 * is asked about the same way, so these take any prefix rather than a mount.
 *
 * All three compare spelling and nothing else. Callers that accept a path from
 * the agent normalize it first (`normalizePath`, or the shell's own
 * `resolvePath`), since `/task/../task` is contained and does not look it.
 *
 * A dependency-free leaf, so the renderer can ask these of a path it is about
 * to draw without the bash sandbox coming with them.
 */

/** Whether `virtualPath` is `root` itself or something inside it. */
export function isAtOrUnder(root: string, virtualPath: string): boolean {
  return relativeWithin(root, virtualPath) !== null;
}

/**
 * Whether `virtualPath` names something inside `root`, the root itself
 * excluded. What to ask when the answer is about a file and the root is a
 * directory that could never be one.
 */
export function isUnder(root: string, virtualPath: string): boolean {
  return virtualPath.startsWith(`${root}/`);
}

/**
 * Path of `virtualPath` within `root`, or null when it is outside.
 *
 * Mirrors just-bash `MountableFs` routing: the root itself yields "/" and
 * anything inside yields the remainder including its leading slash.
 */
export function relativeWithin(
  root: string,
  virtualPath: string,
): null | string {
  if (virtualPath === root) {
    return "/";
  }
  if (virtualPath.startsWith(`${root}/`)) {
    return virtualPath.slice(root.length);
  }
  return null;
}
