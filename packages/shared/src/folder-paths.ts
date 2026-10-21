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
 * A path the way it reads on screen: in the home folder, from that folder's own
 * name (`sam/Documents`), which is what the file manager calls it on every
 * platform; anywhere else, as it is. Keeps the separators it was given.
 *
 * For the screen only: what reaches the model names a folder from its path
 * alone ({@link folderNameFromPath}), the same on every computer.
 */
export function displayHostPath(
  filePath: string,
  homeDir: string | undefined,
): string {
  const names = namesFromHome(filePath, homeDir);
  const separator =
    splitsOnBackslash(filePath, homeDir) && filePath.includes("\\")
      ? "\\"
      : "/";
  return names ? names.join(separator) : filePath;
}

/**
 * `~` and `~/x` written out against the home directory, and `~\x` where home
 * is a Windows path; any other path as given.
 */
export function expandHomePath(
  filePath: string,
  homeDir: string | undefined,
): string {
  if (!homeDir || !/^~(?:[/\\]|$)/.test(filePath)) {
    return filePath;
  }
  const windows = isWindowsPath(homeDir);
  if (filePath.startsWith("~\\") && !windows) {
    return filePath;
  }
  const separator = windows && homeDir.includes("\\") ? "\\" : "/";
  const below = filePath
    .slice(2)
    .split(windows ? /[/\\]/ : "/")
    .filter(Boolean);
  return [homeDir.replace(windows ? /[/\\]+$/ : /\/+$/, ""), ...below].join(
    separator,
  );
}

/** What the user calls a folder: its own name, never any name we assigned it. */
export function folderNameFromPath(folderPath: string): string {
  return namesAlong(folderPath).at(-1) ?? folderPath;
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

/**
 * The names along a path from the home folder down, the home folder called by
 * its own name, for a path in it: spelled out, or from `~`. Undefined for a
 * path outside home, and for any path given without a home directory.
 *
 * Matched the way {@link shortenHomePath} matches, so either platform's
 * separators shorten against a home directory spelled either way.
 */
export function namesFromHome(
  filePath: string,
  homeDir: string | undefined,
): string[] | undefined {
  if (!homeDir) {
    return undefined;
  }
  const normalizedHome = normalizeForCompare(homeDir);
  const normalizedPath = normalizeForCompare(filePath, homeDir);
  if (normalizedHome === "") {
    return undefined;
  }
  const below =
    normalizedPath === "~" || normalizedPath.startsWith("~/")
      ? normalizedPath.slice(1)
      : normalizedPath === normalizedHome ||
          normalizedPath.startsWith(`${normalizedHome}/`)
        ? normalizedPath.slice(normalizedHome.length)
        : undefined;
  return below === undefined
    ? undefined
    : [folderNameFromPath(homeDir), ...below.split("/").filter(Boolean)];
}

/** The folder one level up, or undefined at a filesystem root. */
export function parentSegmentFromPath(folderPath: string): string | undefined {
  const segments = namesAlong(folderPath);
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

/**
 * A path the way a person could type it back: from `~` in the home folder on
 * a Mac or Linux ({@link shortenHomePath}), and as it is anywhere else and on
 * Windows, whose file manager has no `~`. For a path shown to be copied or
 * looked up rather than read as names, like where the Instrument folder is.
 */
export function typedHostPath(
  filePath: string,
  homeDir: string | undefined,
): string {
  return isWindowsPath(filePath)
    ? filePath
    : shortenHomePath(filePath, homeDir);
}

/**
 * Whether a path is spelled the Windows way, from a drive (`C:\`) or a
 * network share (`\\server\share`). Only there is a backslash a separator;
 * on a Mac or Linux it is a character a name can hold.
 */
export function isWindowsPath(hostPath: string): boolean {
  return /^(?:[A-Za-z]:(?:[/\\]|$)|\\\\)/.test(hostPath);
}

/**
 * Whether a backslash separates names in a path: one spelled the Windows way,
 * or one written from `~` against a home directory that is.
 */
function splitsOnBackslash(filePath: string, homeDir?: string): boolean {
  return (
    isWindowsPath(filePath) ||
    (/^~(?:[/\\]|$)/.test(filePath) &&
      homeDir !== undefined &&
      isWindowsPath(homeDir))
  );
}

/** Every name along a path, in order. */
function namesAlong(filePath: string): string[] {
  return filePath
    .split(isWindowsPath(filePath) ? /[/\\]/ : "/")
    .filter(Boolean);
}

/** A path with its separators as `/` and none trailing, to compare by. */
function normalizeForCompare(value: string, homeDir?: string): string {
  return (
    splitsOnBackslash(value, homeDir) ? value.replaceAll("\\", "/") : value
  ).replace(/\/+$/, "");
}
