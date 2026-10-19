/**
 * The path the agent's shell names a host path by. The same path on macOS
 * and Linux; on Windows, the drive-letter spelling Git Bash uses
 * (`/c/Users/sam`), since the shell is POSIX.
 */
export function shellPath(
  hostPath: string,
  platform: string = process.platform,
): string {
  if (platform !== "win32") {
    return hostPath;
  }
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(hostPath);
  return drive
    ? `/${(drive[1] ?? "").toLowerCase()}/${(drive[2] ?? "").replaceAll("\\", "/")}`.replace(
        /\/$/,
        "",
      )
    : hostPath.replaceAll("\\", "/");
}
