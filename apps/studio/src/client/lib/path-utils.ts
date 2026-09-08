import { folderLabelFromPath, shortenHomePath } from "@instrument-org/shared";

/** A path as the user should read it: their own home directory spelled `~`. */
export function displayPath(filePath: string): string {
  return shortenHomePath(filePath, window.api.homeDir);
}

/**
 * What a folder is called on screen. The same rule the agent is told the folder
 * by, so a reply saying "Home" names the folder the card beside it shows.
 */
export function folderLabel(folderPath: string): string {
  return folderLabelFromPath(folderPath, window.api.homeDir);
}

export function filenameFromFilePath(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}
