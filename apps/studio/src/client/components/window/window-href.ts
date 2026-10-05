import { CHATS_HREF } from "@/client/atoms/window";
import {
  type ChatId,
  ChatIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";

/** What follows `/chats/` in an address, or none for an address that is no chat's. */
function chatSegmentOf(href: string): string | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${CHATS_HREF}/`)) {
    return undefined;
  }
  return pathname.slice(CHATS_HREF.length + 1).replace(/\/$/, "");
}

/**
 * The chat a group of tabs is, by its key: a chat's group is keyed by its
 * id, and every other group's key (a draft's, a site's, a hosted page's)
 * has a colon in it, which no chat id does.
 */
export function chatOfGroup(group: string | undefined): ChatId | undefined {
  const id = ChatIdSchema.safeParse(group);
  return id.success ? id.data : undefined;
}

/** The chat whose screen an address is, if it is one. */
export function chatOfHref(href: string): ChatId | undefined {
  const id = ChatIdSchema.safeParse(chatSegmentOf(href));
  return id.success ? id.data : undefined;
}

/**
 * The session an address names a chat by, the way addresses did before a
 * chat had an id of its own: a link in an older reply, a memory saved then.
 * The window opens it at the chat that session is.
 */
export function chatSessionOfHref(href: string): StoreId.Session | undefined {
  const id = StoreId.SessionSchema.safeParse(chatSegmentOf(href));
  return id.success ? id.data : undefined;
}

/**
 * The chat an address names by the start of its id, among the chats the
 * window has.
 *
 * A link a reply writes may carry the first characters of an id rather than
 * all of it, so an address with a whole id is one case of this rather than
 * the only one. Case is ignored the way the agent's own lookup ignores it.
 * Exactly one chat starting with it is the chat; none or several is no
 * chat, since a link that could mean two things should open neither.
 */
export function chatOfHrefPrefix(
  href: string,
  chats: Iterable<ChatId>,
): ChatId | undefined {
  const prefix = chatSegmentOf(href)?.toLowerCase();
  if (!prefix) {
    return undefined;
  }
  const ids = [...chats];
  const whole = ids.find((id) => id === prefix);
  if (whole) {
    return whole;
  }
  const matches = ids.filter((id) => id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The chat an address names by the start of its session, among the chats
 * the window has: an older reply's link may carry the first characters of
 * the session the chat was named by then. Exactly one chat is the chat, as
 * for `chatOfHrefPrefix`.
 */
export function chatOfSessionPrefix(
  href: string,
  chats: Iterable<{ id: ChatId; sessionId: string }>,
): ChatId | undefined {
  const prefix = chatSegmentOf(href)?.toLowerCase();
  if (!prefix?.startsWith("ses_")) {
    return undefined;
  }
  const matches = [...chats].filter((chat) =>
    chat.sessionId.toLowerCase().startsWith(prefix),
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
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
