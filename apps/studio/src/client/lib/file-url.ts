/**
 * A file on the computer as a page: the `file://` address a browser opens it
 * at, which is what the person's own browser would do with the file. A guest
 * loading one gets the browser's own semantics for a local file, relative
 * links included.
 *
 * Written per segment so the separators survive and a name's own characters
 * do not read as syntax. A Windows path's drive letter becomes the first
 * segment, `file:///C:/Users/...`, which is how Chromium spells one. A
 * backslash separates only in a Windows path (a drive's or a share's); on a
 * Mac or Linux it is a letter a name may hold.
 */
export function fileUrlOf(hostPath: string): string {
  const isWindowsPath = /^(?:[a-z]:[\\/]|\\\\)/i.test(hostPath);
  const encoded = hostPath
    .split(isWindowsPath ? /[/\\]/ : "/")
    .filter((segment, index) => index === 0 || segment !== "")
    .map(encodeURIComponent)
    .join("/");
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/** The path on the computer behind a `file://` address; nothing for any other kind of address. */
export function hostPathOfFileUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("file:")) {
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return;
  }
  // The leading slash the URL form put in front of a drive letter.
  if (/^\/[A-Z]:\//i.test(pathname)) {
    return pathname.slice(1).replaceAll("/", "\\");
  }
  return pathname;
}
