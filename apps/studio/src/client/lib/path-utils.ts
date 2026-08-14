import { shortenHomePath } from "@instrument-org/shared";

export { folderNameFromPath } from "@instrument-org/shared";

/** A path as the user should read it: their own home directory spelled `~`. */
export function displayPath(filePath: string): string {
  return shortenHomePath(filePath, window.api.homeDir);
}

export function filenameFromFilePath(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}
