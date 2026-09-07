/** The folder a path on the Mac sits in. */
export function folderOf(hostPath: string) {
  return hostPath.slice(0, hostPath.lastIndexOf("/")) || "/";
}

/** A folder on the Mac the way a person writes it, the home folder as `~`. */
export function homeRelative(hostPath: string, home: string | undefined) {
  if (home === undefined) {
    return hostPath;
  }
  if (hostPath === home) {
    return "~";
  }
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}
