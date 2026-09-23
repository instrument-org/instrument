import { APP_PROTOCOL } from "@instrument-org/shared";

/**
 * A favicon for any URL, as the app keeps it: the main process answers from a
 * copy on disk, fetched once per site from a favicon proxy that has already
 * fetched it (see `electron-main/lib/site-icons.ts`).
 *
 * Only the host is asked for, never the URL as written. An icon belongs to a
 * site rather than to a page, so the path and query buy nothing and are the
 * half worth keeping: a link a model quoted or a person pasted carries document
 * ids, ticket numbers, search terms, and signed parameters, and none of those
 * should travel to draw a twelve-pixel image. Asking per host also collapses
 * every link to one site onto a single kept copy.
 *
 * A source that is not a parseable URL is passed through as it was written, so
 * the caller's own handling of a malformed href is what decides.
 */
export function getFaviconUrl(url: string): string {
  return `${APP_PROTOCOL}://site-icon/${encodeURIComponent(hostOf(url))}`;
}

/**
 * Hosts whose icon did not load this session, so a row drawn again draws its
 * stand-in at once rather than holding an empty slot until the answer repeats.
 * Kept in memory only: the main process holds what is known about a site, and
 * a failure here may have been the network rather than the site.
 */
const iconlessThisSession = new Set<string>();

function hostOf(url: string) {
  return URL.canParse(url) ? new URL(url).hostname : url;
}

export function isIconlessThisSession(url: string): boolean {
  return iconlessThisSession.has(hostOf(url));
}

export function markIconlessThisSession(url: string) {
  iconlessThisSession.add(hostOf(url));
}
