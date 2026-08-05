/** A path as the user should read it: their own home directory spelled `~`. */
export function displayPath(filePath: string): string {
  return shortenHomePath(filePath, window.api.homeDir);
}

export function filenameFromFilePath(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

export function folderNameFromPath(folderPath: string): string {
  return folderPath.split(/[\\/]/).pop() || folderPath;
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
 *
 * Takes the home directory rather than reading it, so it stays testable without
 * a window; {@link displayPath} is what renderer code calls.
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
