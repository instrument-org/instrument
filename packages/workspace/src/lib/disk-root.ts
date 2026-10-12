import path from "node:path";

/**
 * Read once, here: a refusal is worked out inside a running command, where
 * the shell's guard refuses any read of `process.env`.
 */
export const SYSTEM_DRIVE = process.env.SystemDrive ?? "C:";

/**
 * Whether `folder` is the whole of a disk that is never asked for: the system's
 * root, or on Windows the drive it runs from. Another drive's root is the
 * drives place itself, which asks like any folder.
 */
export function isClosedDiskRoot(
  folder: string,
  platform: NodeJS.Platform = process.platform,
  systemDrive = SYSTEM_DRIVE,
): boolean {
  const parse = (value: string) =>
    platform === "win32" ? path.win32.parse(value) : path.posix.parse(value);
  if (parse(folder).root !== folder) {
    return false;
  }
  if (platform !== "win32") {
    return true;
  }
  const drive = /^([A-Za-z]):[\\/]?$/.exec(folder)?.[1];
  return (
    drive === undefined ||
    drive.toUpperCase() === systemDrive.slice(0, 1).toUpperCase()
  );
}
