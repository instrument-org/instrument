import { CHATS_HREF } from "@/client/atoms/window";
import { StoreId } from "@instrument-org/workspace/client";

/** The chat whose screen an address is, if it is one. */
export function chatOfHref(href: string): StoreId.Session | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${CHATS_HREF}/`)) {
    return undefined;
  }
  const id = StoreId.SessionSchema.safeParse(
    pathname.slice(CHATS_HREF.length + 1).replace(/\/$/, ""),
  );
  return id.success ? id.data : undefined;
}

/**
 * The chat an address names by the start of its id, among the chats the
 * window has.
 *
 * The agent's own listing prints a chat as the first characters of its id,
 * and a link written from that listing carries the same, so an address with
 * a whole id is one case of this rather than the only one. Case is ignored
 * the way the listing's own lookup ignores it. Exactly one chat starting
 * with it is the chat; none or several is no chat, since a link that
 * could mean two things should open neither.
 */
export function chatOfHrefPrefix(
  href: string,
  chats: Iterable<StoreId.Session>,
): StoreId.Session | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${CHATS_HREF}/`)) {
    return undefined;
  }
  const prefix = pathname
    .slice(CHATS_HREF.length + 1)
    .replace(/\/$/, "")
    .toLowerCase();
  if (!prefix) {
    return undefined;
  }
  const matches = [...chats].filter((id) =>
    id.toLowerCase().startsWith(prefix),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** A screen's address, taken apart: the route and its search. */
export function parseHref(href: string) {
  const url = new URL(href, "http://tabs");
  return { pathname: url.pathname, search: url.searchParams };
}

/** Two addresses are one screen when the route and every search entry agree, however either was encoded. */
export function sameHref(a: string, b: string) {
  const [x, y] = [parseHref(a), parseHref(b)];
  if (x.pathname.replace(/\/$/, "") !== y.pathname.replace(/\/$/, "")) {
    return false;
  }
  return searchEntries(x.search) === searchEntries(y.search);
}

function searchEntries(search: URLSearchParams) {
  return [...search.entries()].sort().join("&");
}
