import { getFileType } from "./get-file-type";

/**
 * Words typed or pasted into an address field that name a place on the
 * computer, the one reading every field shares (the tab's address field, the
 * command menu, a new tab, a page's own bar), so a path goes to the same
 * place from each.
 *
 * This only says the words are a path and how to show them; what is there is
 * asked of the main process once the person presses Return
 * (`computer.locate`), which reads them again the same way and knows the
 * home folder, the shell's spellings and the system's own answers.
 */
export interface TypedPath {
  /**
   * Whether the words may as well be a search: a path from the root that is
   * nothing but slashes and words, like `/r/rust`, which a person may have
   * meant for the web.
   */
  alsoSearch: boolean;
  /** The path as the row says it: {@link written}, without the separators trailing it. */
  shown: string;
  /** The words as typed, trimmed, which is what is asked about. */
  typed: string;
  /**
   * The path as a person would have typed it: quotes and a Terminal's
   * escapes gone, a `file://` address as its path, and a trailing separator
   * kept, since a folder's listing goes on from one.
   */
  written: string;
}

/**
 * A path from the root, the home folder as `~`, or a `file://` address on
 * every computer; on Windows, a drive (`C:\`, `C:/`), a share
 * (`\\server\share`), and the agent's shell spelling (`/c/Users`, `/tmp`),
 * where a path from the root of no drive is no place and is left a search.
 * A backslash is a path's separator only on Windows; elsewhere it is a
 * letter a name may hold.
 */
export function typedPathOf(
  words: string,
  platform: string,
): TypedPath | undefined {
  const typed = words.trim();
  const unquoted = /^(["'])(.*)\1$/s.exec(typed)?.[2]?.trim() ?? typed;
  if (unquoted === "") {
    return;
  }
  const found = (written: string, alsoSearch = false): TypedPath => ({
    alsoSearch,
    shown: withoutTrailingSeparators(written),
    typed,
    written,
  });
  const isWindows = platform === "win32";
  if (/^file:/i.test(unquoted)) {
    // A page's address with a query or a fragment names a place in the
    // page, which only the page reaches; its path alone would lose it.
    if (isPlaceInPage(unquoted)) {
      return;
    }
    const written = pathOfFileUrl(unquoted);
    return written === undefined ? undefined : found(written);
  }
  if (unquoted === "~" || (isWindows ? /^~[\\/]/ : /^~\//).test(unquoted)) {
    return found(unquoted);
  }
  if (isWindows) {
    if (
      /^[a-z]:(?:[\\/]|$)/i.test(unquoted) ||
      /^\\\\[^\\/]+[\\/][^\\/]+/.test(unquoted) ||
      /^\/tmp(?:\/|$)/i.test(unquoted)
    ) {
      return found(unquoted);
    }
    // The shell's spelling of a drive, which `/r/rust` is too: the system
    // drive is the one a person pastes from the agent's replies.
    if (/^\/[a-z](?:\/|$)/i.test(unquoted)) {
      return found(unquoted, !/^\/c(?:\/|$)/i.test(unquoted));
    }
    return;
  }
  if (!unquoted.startsWith("/")) {
    return;
  }
  const written = unquoted.replace(SHELL_ESCAPED, "$1");
  const shown = withoutTrailingSeparators(written);
  return found(
    written,
    /^(?:\/[\w.-]+)+$/.test(shown) &&
      !SYSTEM_ROOTS.has(shown.split("/")[1] ?? ""),
  );
}

/**
 * Whether words read as a path on any computer, for what must never leave
 * the app as a search (the engine's suggestions as the words are typed).
 */
export function isPathLike(words: string) {
  return (["darwin", "win32"] as const).some(
    (platform) => typedPathOf(words, platform) !== undefined,
  );
}

/**
 * The file a typed path names, by its name alone, for a row's icon before
 * anything is read: a last name with an extension, without a separator
 * after it. What is really there is only known once it is looked up.
 */
export function typedFileName(path: TypedPath) {
  if (path.written !== path.shown) {
    return;
  }
  const name = path.shown.split(/[\\/]/).at(-1) ?? "";
  return /^[^.].*\.[^.\s]+$/.test(name) ? name : undefined;
}

/**
 * The folders at the root of a Mac or a Linux computer, which no search
 * starts with: a path from one of them is a path.
 */
const SYSTEM_ROOTS = new Set([
  "Applications",
  // oxlint-disable-next-line studio/no-os-words -- a folder's name at the root, never shown
  "Library",
  "System",
  "Users",
  "Volumes",
  "bin",
  "dev",
  "etc",
  "home",
  "media",
  "mnt",
  "opt",
  "private",
  "proc",
  "root",
  "run",
  "sbin",
  "srv",
  "tmp",
  "usr",
  "var",
]);

/** What a Terminal escapes with a backslash when a name is dragged or completed into it. */
const SHELL_ESCAPED = /\\([ !"#$&'()*,;<=>?@[\\\]^`{|}~])/g;

/**
 * A path without the separators trailing it, which say nothing about where
 * it is; the root and a drive's top keep theirs, as they are written.
 */
export function withoutTrailingSeparators(path: string) {
  return path.length > 1 && !/^[a-z]:[\\/]$/i.test(path)
    ? path.replace(/[\\/]+$/, "") || path[0] || path
    : path;
}

/** Whether a `file://` address is an HTML file's with a query or a fragment after it. */
function isPlaceInPage(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return (
    (url.search !== "" || url.hash !== "") &&
    getFileType({ filename: url.pathname }) === "html"
  );
}

/** A `file://` address as the path it names, the home folder as `~`. */
function pathOfFileUrl(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return;
  }
  if (url.host !== "" && url.host !== "localhost") {
    return `\\\\${url.host}${pathname.replaceAll("/", "\\")}`;
  }
  if (/^\/~(?:\/|$)/.test(pathname)) {
    return pathname.slice(1);
  }
  const drive = /^\/([a-z]:)(\/.*)?$/i.exec(pathname);
  if (drive) {
    return `${drive[1] ?? ""}${(drive[2] ?? "\\").replaceAll("/", "\\")}`;
  }
  return pathname;
}
