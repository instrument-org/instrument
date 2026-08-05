/**
 * How an attached folder's path becomes words a person recognizes.
 *
 * Deliberately free of `node:path` and `node:os`: the renderer renders folder
 * names too, and these run inside modules the client bundle reaches. Separators
 * are handled for both platforms rather than the host's, since a stored path
 * outlives the machine that produced it (an imported task, a shared transcript).
 */

/** What the user calls a folder: its own name, never its mount name. */
export function folderDisplayName(folderPath: string): string {
  return lastSegment(folderPath) ?? folderPath;
}

/**
 * The folder one level up, for telling two same-named folders apart in words.
 * Undefined at a filesystem root, where there is nothing to point at.
 *
 * Raw: callers showing this to anyone are responsible for the home directory,
 * whose name is the user's account name (see `folderParentLabel`).
 */
export function folderParentSegment(folderPath: string): string | undefined {
  const segments = folderPath.split(/[/\\]/).filter(Boolean);
  return segments.length >= 2 ? segments.at(-2) : undefined;
}

function lastSegment(folderPath: string): string | undefined {
  return folderPath.split(/[/\\]/).findLast(Boolean);
}
