import { type RegisteredRouter } from "@tanstack/react-router";
import {
  type ChatId,
  ChatIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";

/**
 * A screen of the window, read off its address: every address a tab can
 * stand at or a link can name, taken apart once, with each id parsed into
 * its type. Anything that asks what an address is switches on `kind`.
 */
export type Screen =
  | { kind: "app"; slug: string }
  | { kind: "apps" }
  | { kind: "browser" }
  /** A chat's address naming the start of an id or of a session, the way a reply's link may; which chat it is depends on the chats there are. */
  | { kind: "chatLink"; segment: string }
  | { chat: ChatId; kind: "chat" }
  /** A chat named by its session, the way addresses did before a chat had an id of its own. */
  | { kind: "chatOfSession"; session: StoreId.Session }
  | (ComputerTab & { kind: "computer" })
  | { kind: "debug"; pathname: string }
  | { kind: "inbox" }
  | { kind: "memory"; name: string }
  | { kind: "namedScreen"; name: string }
  | { kind: "newTab" }
  | { kind: "releaseNotes" }
  | { kind: "setting"; name: string }
  /** A site opened at the window's own level, by the id its group is kept under. */
  | { id: string; kind: "site" }
  | { kind: "skill"; name: string }
  | { chat?: ChatId; kind: "task"; task: StoreId.Session }
  | { chat?: ChatId; kind: "tasks" }
  | { kind: "unknown" };

/** The folder or file a computer tab stands at, from the computer route's search. */
export interface ComputerTab {
  file?: string;
  path: string;
  root: string;
  tree?: string;
}

/** A path of the route tree, as the router writes it. */
type RoutePath = keyof RegisteredRouter["routesByPath"];

/**
 * The routes a screen is at. Typed against the route tree, so a route
 * renamed or removed is an error here, and `window-href.routes.test.tsx`
 * checks that the router reads each address the way `matchScreen` does.
 */
export const SCREEN_ROUTES = {
  app: "/apps/$slug",
  apps: "/apps/",
  browser: "/browser",
  chat: "/chats/$id",
  computer: "/files",
  debug: "/debug",
  inbox: "/chats/",
  newTab: "/new-tab",
  releaseNotes: "/release-notes",
  site: "/sites/$id",
  task: "/tasks/$sessionId",
  tasks: "/tasks/",
} as const satisfies Record<string, RoutePath>;

/**
 * Addresses a link names that are no route of the window's: the window
 * opens each where that thing lives (Settings, a dialog, a skill's folder in
 * Files) rather than as a screen of its own.
 */
export const LINK_ADDRESSES = {
  memory: "/memory/$name",
  namedScreen: "/screen/$name",
  setting: "/settings/$name",
  skill: "/skills/$name",
} as const;

/** The parameters a path template names, by name. */
type ParamsOf<T extends string> =
  T extends `${string}$${infer Param}/${infer Rest}`
    ? Record<Param, string> & ParamsOf<Rest>
    : T extends `${string}$${infer Param}`
      ? Param extends ""
        ? Record<never, string>
        : Record<Param, string>
      : Record<never, string>;

/**
 * The parameters of a path at a template, decoded, or none when the path is
 * not at it. A parameter is one whole segment, never empty; a trailing slash
 * on either is no segment. With `under`, the path may go on below the
 * template, the way a route's children are under it.
 */
function matchPath<T extends string>(
  template: T,
  pathname: string,
  { under = false }: { under?: boolean } = {},
): ParamsOf<T> | undefined {
  const want = segmentsOfPath(template);
  const have = segmentsOfPath(pathname);
  if (under ? have.length < want.length : have.length !== want.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const value = have[index] ?? "";
    if (segment.startsWith("$")) {
      params[segment.slice(1)] = decoded(value);
    } else if (segment !== value) {
      return undefined;
    }
  }
  // The keys set are the template's own parameters, which is what the
  // type reads off the template.
  return params as ParamsOf<T>;
}

/** The address of a template with its parameters filled in, each encoded. */
export function pathOf<T extends string>(template: T, params: ParamsOf<T>) {
  const values: Record<string, string> = params;
  const path = segmentsOfPath(template)
    .map((segment) =>
      segment.startsWith("$")
        ? encodeURIComponent(values[segment.slice(1)] ?? "")
        : segment,
    )
    .join("/");
  return `/${path}`;
}

function segmentsOfPath(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

/** A segment as written, decoded where it can be: the router writes a colon (`provider:<id>`) as `%3A`. */
function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** What screen an address is. */
export function matchScreen(href: string): Screen {
  const { pathname, search } = parseHref(href);
  const at = <T extends string>(template: T) => matchPath(template, pathname);
  if (at(SCREEN_ROUTES.newTab)) {
    return { kind: "newTab" };
  }
  if (at(SCREEN_ROUTES.browser)) {
    return { kind: "browser" };
  }
  if (at(SCREEN_ROUTES.computer)) {
    const file = search.get("file");
    const tree = search.get("tree");
    return {
      kind: "computer",
      ...(file === null ? {} : { file }),
      path: search.get("path") ?? "",
      root: search.get("root") ?? "~",
      ...(tree === null ? {} : { tree }),
    };
  }
  if (at(SCREEN_ROUTES.apps)) {
    return { kind: "apps" };
  }
  const app = at(SCREEN_ROUTES.app);
  if (app) {
    return { kind: "app", slug: app.slug };
  }
  if (at(SCREEN_ROUTES.inbox)) {
    return { kind: "inbox" };
  }
  const chat = at(SCREEN_ROUTES.chat);
  if (chat) {
    const id = ChatIdSchema.safeParse(chat.id);
    if (id.success) {
      return { chat: id.data, kind: "chat" };
    }
    const session = StoreId.SessionSchema.safeParse(chat.id);
    return session.success
      ? { kind: "chatOfSession", session: session.data }
      : { kind: "chatLink", segment: chat.id };
  }
  const site = at(SCREEN_ROUTES.site);
  if (site) {
    return { id: site.id, kind: "site" };
  }
  const forChat = ChatIdSchema.safeParse(search.get("chat"));
  const tasksChat = forChat.success ? { chat: forChat.data } : {};
  if (at(SCREEN_ROUTES.tasks)) {
    return { kind: "tasks", ...tasksChat };
  }
  const task = at(SCREEN_ROUTES.task);
  if (task) {
    const id = StoreId.SessionSchema.safeParse(task.sessionId);
    return id.success
      ? { kind: "task", task: id.data, ...tasksChat }
      : { kind: "unknown" };
  }
  if (at(SCREEN_ROUTES.releaseNotes)) {
    return { kind: "releaseNotes" };
  }
  if (matchPath(SCREEN_ROUTES.debug, pathname, { under: true })) {
    return { kind: "debug", pathname };
  }
  for (const kind of ["memory", "namedScreen", "setting", "skill"] as const) {
    const link = at(LINK_ADDRESSES[kind]);
    if (link) {
      return { kind, name: link.name };
    }
  }
  return { kind: "unknown" };
}

/**
 * The address of a chat's screen, or of a chat named by its session, which
 * opens at the chat that session is.
 */
export function chatHref(chat: ChatId | StoreId.Session): string {
  return pathOf(SCREEN_ROUTES.chat, { id: chat });
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
  const screen = matchScreen(href);
  return screen.kind === "chat" ? screen.chat : undefined;
}

/**
 * The session an address names a chat by, the way addresses did before a
 * chat had an id of its own: a link in an older reply, a memory saved then.
 * The window opens it at the chat that session is.
 */
export function chatSessionOfHref(href: string): StoreId.Session | undefined {
  const screen = matchScreen(href);
  return screen.kind === "chatOfSession" ? screen.session : undefined;
}

/** What follows `/chats/` in an address, as written, or none for an address that is no chat's. */
function chatSegmentOf(href: string): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "chat": {
      return screen.chat;
    }
    case "chatLink": {
      return screen.segment;
    }
    case "chatOfSession": {
      return screen.session;
    }
    default: {
      return undefined;
    }
  }
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
