/**
 * How a host path becomes words a person recognizes.
 *
 * Shared because both sides render the same folder: the renderer draws it in
 * the composer and the transcript, and the workspace names it for the model and
 * for a task's title. Two implementations of this drifted apart once already,
 * over whether a trailing separator counts as a segment.
 *
 * Pure, with no `node:path`: the renderer reaches this, and a stored path
 * outlives the machine that produced it (an imported task, a shared
 * transcript), so both platforms' separators are handled rather than the host's.
 */

/** What the user calls a folder: its own name, never any name we assigned it. */
export function folderNameFromPath(folderPath: string): string {
  return folderPath.split(/[/\\]/).findLast(Boolean) ?? folderPath;
}

/** The folder one level up, or undefined at a filesystem root. */
export function parentSegmentFromPath(folderPath: string): string | undefined {
  const segments = folderPath.split(/[/\\]/).filter(Boolean);
  return segments.length >= 2 ? segments.at(-2) : undefined;
}

/**
 * A path under the user's home directory, spelled with `~`. Anything outside
 * home, and any path given without a home directory, is returned unchanged.
 *
 * Matching is separator-insensitive so a Windows path shortens against a home
 * directory spelled either way, and it stops at a separator so a sibling
 * directory sharing a prefix (`/Users/samantha` next to `/Users/sam`) is not
 * mistaken for a child. The result keeps the separators it was given, so a list
 * mixing paths inside and outside home does not mix `\` with `/`.
 */
export function shortenHomePath(
  filePath: string,
  homeDir: string | undefined,
): string {
  if (!homeDir) {
    return filePath;
  }
  const normalizedHome = normalizeForCompare(homeDir);
  const normalizedPath = normalizeForCompare(filePath);
  if (normalizedHome === "") {
    return filePath;
  }
  if (normalizedPath === normalizedHome) {
    return "~";
  }
  if (!normalizedPath.startsWith(`${normalizedHome}/`)) {
    return filePath;
  }
  return `~${filePath.slice(normalizedHome.length)}`;
}

function normalizeForCompare(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}
