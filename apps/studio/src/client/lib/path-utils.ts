import { displayHostPath, folderNameFromPath } from "@instrument-org/shared";

/** A path as the user should read it: from their home folder's own name when it is in it. */
export function displayPath(filePath: string): string {
  return displayHostPath(filePath, window.api.homeDir);
}

export function filenameFromFilePath(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

/**
 * What a folder is called on screen: its own name, the home folder included,
 * the way the file manager names it.
 */
export function folderLabel(folderPath: string): string {
  return folderNameFromPath(folderPath);
}

/**
 * A folder the agent named, as this computer spells it. The agent's shell
 * writes a Windows drive as `/c/Users/x`; everywhere else the path is already
 * the computer's own.
 */
export function hostPathFromShellPath(
  shellPath: string,
  isWindows: boolean,
): string {
  const drive = isWindows ? /^\/([a-zA-Z])(?:\/(.*))?$/.exec(shellPath) : null;
  if (!drive) {
    return shellPath;
  }
  const rest = (drive[2] ?? "").replaceAll("/", "\\");
  return `${(drive[1] ?? "").toUpperCase()}:\\${rest}`;
}
