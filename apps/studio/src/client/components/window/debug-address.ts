import { APP_NAME_SLUG, isInstrumentAddress } from "@instrument-org/shared";

import { SCREEN_ROUTES } from "./window-href";

/**
 * The debug pages' addresses, a developer mode's own: the landing page at
 * `instrument://debug`, and each page under it at its path below `/debug`,
 * with whatever its search says (`instrument://debug/components/transcript?scenario=<id>`).
 * They stay out of the nouns a reply links with (`instrumentLinkOf`), so
 * nothing the agent reads names them and no link outside the window opens
 * one.
 */
const DEBUG_HOST = "debug";

/** The address the field shows for a debug page's href, or none for any other screen. */
export function debugAddressOf(href: string): string | undefined {
  const url = URL.parse(href, "http://tabs");
  if (!url) {
    return undefined;
  }
  const below = belowDebug(url.pathname);
  return below === undefined
    ? undefined
    : `${APP_NAME_SLUG}://${DEBUG_HOST}${below}${url.search}`;
}

/**
 * The debug page an address names, as the href its tab stands at, in either
 * scheme the app answers to; none for any other address.
 */
export function debugHrefOf(address: string): string | undefined {
  if (!isInstrumentAddress(address)) {
    return undefined;
  }
  const url = new URL(address);
  if (url.host.toLowerCase() !== DEBUG_HOST) {
    return undefined;
  }
  return `${SCREEN_ROUTES.debug}${withoutTrailingSlash(url.pathname)}${url.search}`;
}

/** The part of a path below `/debug`, empty for the landing page; none for a path elsewhere. */
function belowDebug(pathname: string): string | undefined {
  const path = withoutTrailingSlash(pathname);
  if (path === SCREEN_ROUTES.debug) {
    return "";
  }
  return path.startsWith(`${SCREEN_ROUTES.debug}/`)
    ? path.slice(SCREEN_ROUTES.debug.length)
    : undefined;
}

function withoutTrailingSlash(path: string) {
  return path.replace(/\/+$/, "");
}
