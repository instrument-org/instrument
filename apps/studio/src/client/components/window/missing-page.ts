/**
 * A page that doesn't exist, as a tab stands at it. A tab at an address no
 * screen answers (one a later build removed, or one a bug built) stands at
 * that address, and the router's not-found page says so there. An
 * `instrument://` address the app doesn't know has no address of the
 * window's own, so its tab stands at this path with the address in its
 * search, which no route answers either.
 */
const MISSING_PATH = "/missing";

/** The address a tab stands at for an `instrument://` address the app doesn't know. */
export function missingHref(address: string): string {
  return `${MISSING_PATH}?${new URLSearchParams({ address }).toString()}`;
}

/**
 * The address a tab at a page that doesn't exist was asked for, as the
 * field and the page show it: the `instrument://` address typed or opened,
 * or else the tab's own.
 */
export function askedAddressOf(href: string): string {
  const url = URL.parse(href, "http://tabs");
  return url?.pathname === MISSING_PATH
    ? (url.searchParams.get("address") ?? href)
    : href;
}
