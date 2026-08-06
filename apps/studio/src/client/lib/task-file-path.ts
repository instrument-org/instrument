import { ATTACHED_FOLDERS_MOUNT_ROOT } from "@instrument-org/workspace/client";

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
 */
export function isAddressableTaskFilePath(path: string): boolean {
  if (path.includes("\\") || path.split("/").includes("..")) {
    return false;
  }

  return (
    !path.startsWith("/") || path.startsWith(`${ATTACHED_FOLDERS_MOUNT_ROOT}/`)
  );
}
