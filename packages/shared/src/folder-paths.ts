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

/**
 * What the home folder is called instead of what it is called on disk, which is
 * the account name. That name is real PII -- it reaches agent context, session
 * markdown exports, and shared task transcripts -- and it is a poor label
 * besides, so the substitution holds everywhere the folder is named: on screen,
 * to the model, and in the path the agent reads it at.
 */
export const HOME_DIR_LABEL = "Home";

/** What the user calls a folder: its own name, never any name we assigned it. */
export function folderNameFromPath(folderPath: string): string {
  return folderPath.split(/[/\\]/).findLast(Boolean) ?? folderPath;
}

/**
 * What a folder is called wherever it is named for a person. Its own name,
 * except the home folder. Given no home directory nothing is the home folder,
 * so every folder is called what it is called on disk.
 */
export function folderLabelFromPath(
  folderPath: string,
  homeDir: string | undefined,
): string {
  return isHomeDir(folderPath, homeDir)
    ? HOME_DIR_LABEL
    : folderNameFromPath(folderPath);
}

/** Whether a path is the home directory itself, spelled either way. */
export function isHomeDir(
  filePath: string,
  homeDir: string | undefined,
): boolean {
  if (!homeDir) {
    return false;
  }
  const normalizedHome = normalizeForCompare(homeDir);
  return (
    normalizedHome !== "" && normalizeForCompare(filePath) === normalizedHome
  );
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
