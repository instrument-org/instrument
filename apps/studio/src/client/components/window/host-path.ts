/** The folder a path on the computer sits in. */
export function folderOf(hostPath: string) {
  const separator = separatorOf(hostPath);
  const at = hostPath.lastIndexOf(separator);
  return at <= 0 ? separator : hostPath.slice(0, at);
}

/**
 * A folder on the computer the way a person writes it, the home folder as `~`.
 *
 * Only where a person would: `~` is how a Mac and a Linux desktop spell it, and
 * on Windows it is a character nobody there has ever seen a folder called, so a
 * path is written out in full.
 */
export function homeRelative(hostPath: string, home: string | undefined) {
  if (home === undefined || separatorOf(home) === "\\") {
    return hostPath;
  }
  if (hostPath === home) {
    return "~";
  }
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}

/** Whether a path is that folder or something inside it. */
export function isInside(hostPath: string, folder: string) {
  const base = folder.replace(/[/\\]$/, "");
  return hostPath === base || hostPath.startsWith(base + separatorOf(hostPath));
}

/**
 * A path on the computer, extended by names below it.
 *
 * The names are spelled the way the path is: a virtual path is always written
 * with slashes, and joining one onto a Windows folder with the slashes left in
 * gives `C:\Users\sam\Documents/report.pdf`, which every Windows API accepts
 * and no person there has ever written.
 */
export function joinHostPath(base: string, ...below: string[]) {
  const names = below.flatMap((part) => segmentsOf(part));
  if (names.length === 0) {
    return base;
  }
  return [base.replace(/[/\\]+$/, ""), ...names].join(separatorOf(base));
}

/** Every name along a path, in order, whichever way the path is spelled. */
export function segmentsOf(hostPath: string) {
  return hostPath.split(/[/\\]/).filter(Boolean);
}

/**
 * The separator the computer this path came from writes.
 *
 * Read off the path rather than off the platform, since these are pure and the
 * paths reach the window from the workspace already spelled its way.
 */
export function separatorOf(hostPath: string) {
  return hostPath.includes("\\") ? "\\" : "/";
}
