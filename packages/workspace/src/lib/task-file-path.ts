import { MOUNT } from "../mount-points";

/**
 * Whether a path is one this app can address at all: somewhere inside the task,
 * or inside a folder the user shared.
 *
 * A question about the string rather than about disk, which is what makes it
 * safe to ask while rendering. Every surface that draws a file reference asks
 * it, and asks it the same way, because the agent writes one path grammar and a
 * reference should not mean different things in different parts of one reply.
 *
 * What it is really for: the references being drawn come from model output, so
 * a host path can appear among them. `/Users/someone/.ssh/id_rsa` has to read
 * as prose, since no version of clicking it opens anything, and an affordance
 * that looks like it would is worse than no affordance at all.
 *
 * It lives here rather than in the renderer because `show` and the pane state
 * ask it too, and a grammar with two implementations is a grammar that drifts.
 */
export function isAddressableTaskFilePath(path: string): boolean {
  if (path.includes("\\") || path.split("/").includes("..")) {
    return false;
  }

  return (
    !path.startsWith("/") ||
    path.startsWith(`${MOUNT.attachedFolders}/`) ||
    path.startsWith(`${MOUNT.skills}/`)
  );
}

/**
 * Whether a path a reply named is a folder rather than a file.
 *
 * A trailing slash is the whole of the grammar. It is the one mark a path can
 * carry that a file's never does, it is what a person writing a folder down
 * already writes, and it means the same thing in a `files` fence as it does in
 * a shell -- so a reply naming a folder needs nothing taught beyond the slash.
 *
 * A question about the string, like the one above it: nothing here asks disk.
 * A reply handed over the folder it named whether or not that folder is still
 * there, and the honest time to find out is when someone opens it.
 */
export function isFolderPath(path: string): boolean {
  return path.endsWith("/");
}

/**
 * The name a path is known by: the last segment, folder or file.
 *
 * Written for the two together because the trailing slash makes the naive
 * split wrong for exactly one of them, and a folder drawn with no name at all
 * is what that costs.
 */
export function nameOfPath(path: string): string {
  return path.split("/").findLast(Boolean) ?? path;
}
