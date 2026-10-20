/** A path naming its Windows drive: `C:\Users\sam`, `C:/Users/sam`. */
const DRIVE_PATH = /^([A-Za-z]):[\\/]/;

/** A path on a network share: `\\server\share\a.txt`. */
const SHARE_PATH = /^\\\\[^\\/]/;

/**
 * The one spelling a file reference from a reply is read in.
 *
 * Tool outputs (e.g. generate_image) keep the agent-facing "./"-prefixed
 * convention from fixRelativePath; chat file index paths are bare. Strip
 * the prefix when building URLs or resolving a path from either source.
 *
 * A Windows drive path (`C:\Users\sam\a.txt`, `C:/Users/sam/a.txt`) is how a
 * person writes a file down, and a reply may hand one back; it is read as the
 * shell's spelling of the same file (`/c/Users/sam/a.txt`), so every surface
 * that draws a reference knows one grammar. A path on a network share
 * (`\\server\share\a.txt`) is read the same way, as `//server/share/a.txt`.
 */
export function normalizeChatFilePath(filePath: string): string {
  const drive = DRIVE_PATH.exec(filePath);
  if (drive) {
    return `/${(drive[1] ?? "").toLowerCase()}/${filePath.slice(3).replaceAll("\\", "/")}`;
  }
  if (SHARE_PATH.test(filePath)) {
    return filePath.replaceAll("\\", "/");
  }
  return filePath.startsWith("./") ? filePath.slice(2) : filePath;
}

/**
 * Whether a link's target names a Windows drive, which reads as a URL scheme
 * (`C:`) to anything that only asks for one. The backslash may arrive
 * percent-encoded, as a Markdown parser writes it.
 */
export function isDriveHref(href: string): boolean {
  return /^[A-Za-z]:(?:[\\/]|%5C)/i.test(href);
}

/**
 * Whether a link's target names a Windows file: by its drive, or on a network
 * share (`\\server\share`), which would otherwise read as no file at all.
 */
export function isWindowsPathHref(href: string): boolean {
  return isDriveHref(href) || /^(?:\\|%5C){2}[^\\/%]/i.test(href);
}
