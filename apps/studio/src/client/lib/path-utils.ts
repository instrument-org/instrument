import { displayHostPath, folderLabelFromPath } from "@instrument-org/shared";

/** A path as the user should read it: from their home folder's own name when it is in it. */
export function displayPath(filePath: string): string {
  return displayHostPath(filePath, window.api.homeDir);
}

export function filenameFromFilePath(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

/**
 * What a folder is called on screen. The same rule the agent is told the folder
 * by, so a reply saying "Home" names the folder the card beside it shows.
 */
export function folderLabel(folderPath: string): string {
  return folderLabelFromPath(folderPath, window.api.homeDir);
}
