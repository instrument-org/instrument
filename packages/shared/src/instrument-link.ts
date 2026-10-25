import { APP_NAME_SLUG, APP_PROTOCOL } from "./constants";

// The one reading of an `instrument://` address, for the window that opens
// it and the check that tells the agent a link in its reply opens nothing.

/** What an `instrument://` address names, and where in the window that is. */
export interface InstrumentLink {
  /** The screen address the window opens it at. */
  href: string;
  kind: InstrumentLinkKind;
  /** The thing's own name: a slug, a session id or its prefix. */
  name: string;
}

/**
 * The things inside the app an address can name, by the noun the address
 * leads with. Each is a kind of thing a reply mentions and a person can be
 * taken to, and the noun is the one the agent's own commands use for it.
 */
type InstrumentLinkKind =
  | "app"
  | "chat"
  | "memory"
  | "screen"
  | "settings"
  | "skill"
  | "task";

/**
 * The nouns an address may lead with, each with the screen prefix its thing
 * lives under.
 */
const HOSTS = {
  app: { kind: "app", prefix: "/apps" },
  chat: { kind: "chat", prefix: "/chats" },
  memory: { kind: "memory", prefix: "/memory" },
  screen: { kind: "screen", prefix: "/screen" },
  settings: { kind: "settings", prefix: "/settings" },
  skill: { kind: "skill", prefix: "/skills" },
  task: { kind: "task", prefix: "/tasks" },
} as const satisfies Record<
  string,
  { kind: InstrumentLinkKind; prefix: string }
>;

type Host = keyof typeof HOSTS;

const isHost = (host: string): host is Host => Object.hasOwn(HOSTS, host);

/**
 * A name as it may appear in an address: one path segment of the characters
 * every kind's names are made of, which for a skill includes the colon its
 * qualified name carries (`instrument:create-page`). What it names is the
 * opener's question; a deleted memory or a task from a chat since closed
 * is still an address.
 */
const NAME = /^[\w.:-]+$/;

/**
 * The scheme the app answers to. The build's own protocol is what the OS
 * hands over, and the released app's is what a reply writes: a link the
 * agent wrote in a development build reads the same as one in a release.
 */
const SCHEMES = new Set([`${APP_NAME_SLUG}:`, `${APP_PROTOCOL}:`]);

/** Whether an address is the app's own, whether or not it names anything. */
export function isInstrumentAddress(url: string): boolean {
  return URL.canParse(url) && SCHEMES.has(new URL(url).protocol);
}

/**
 * The file path an `instrument://file/<path>` address names, or undefined for
 * any other address. A file is handed over as a path, not as a place in the
 * window, but a reply taught to link tasks and chats this way reaches for
 * the same form for a file, and the path in it is the one it meant.
 */
export function filePathOfInstrumentLink(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (!SCHEMES.has(parsed.protocol) || parsed.host.toLowerCase() !== "file") {
    return undefined;
  }
  // `instrument://file//Users/sam/a.md` and `instrument://file/Users/sam/a.md` both mean
  // the absolute path the reply had in hand.
  const path = decoded(parsed.pathname).replace(/^\/+/, "/");
  return path === "/" ? undefined : path;
}

/**
 * What a link from outside the app asks for: a screen one of the nouns
 * names, a file or folder by its path (spelled as the address has it, which
 * the opener still checks), or a new chat with words already written.
 */
export type OutsideLink =
  | { href: string; kind: "screen" }
  | { kind: "file"; path: string }
  | { kind: "new"; topic?: string; words: string };

/** The longest words a `new` link may bring; a longer one opens nothing. */
export const OUTSIDE_WORDS_MAX = 2000;

/**
 * Characters that change nothing a person sees but reach the model: zero
 * width spaces and joiners other than the emoji joiner, the marks that turn
 * text around, the soft hyphen and the byte-order mark, and the tag block,
 * which spells whole hidden sentences.
 */
const UNSEEN =
  /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * Reads a link handed to the app from outside: a browser, another app, a
 * note. Everything a noun names is a screen, `file` a path, and `new` the
 * one verb, `instrument://new?text=<words>&topic=<id>`, a new chat's draft
 * that is never sent for the person.
 */
export function outsideLinkOf(url: string): OutsideLink | undefined {
  const link = instrumentLinkOf(url);
  if (link) {
    return { href: link.href, kind: "screen" };
  }
  const path = filePathOfInstrumentLink(url);
  if (path !== undefined) {
    return { kind: "file", path };
  }
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (
    !SCHEMES.has(parsed.protocol) ||
    parsed.host.toLowerCase() !== "new" ||
    !["", "/"].includes(parsed.pathname)
  ) {
    return undefined;
  }
  const words = (parsed.searchParams.get("text") ?? "")
    .replaceAll(UNSEEN, "")
    .trim();
  if (words.length > OUTSIDE_WORDS_MAX) {
    return undefined;
  }
  const topic = parsed.searchParams.get("topic") ?? undefined;
  return {
    kind: "new",
    ...(topic !== undefined && NAME.test(topic) ? { topic } : {}),
    words,
  };
}

/** A chat's address, which is how a file names the chat it belongs to. */
export function chatAddressOf(id: string): string {
  return `${APP_NAME_SLUG}://chat/${id}`;
}

/**
 * The chat id a file's `chat:` names: the chat's address, or a bare id,
 * which reads the same. Undefined for an address of anything else.
 */
export function chatIdNamedBy(value: string): string | undefined {
  const named = value.trim();
  if (!isInstrumentAddress(named)) {
    return named === "" ? undefined : named;
  }
  const link = instrumentLinkOf(named);
  return link?.kind === "chat" ? link.name : undefined;
}

/** What an address names inside the app, or undefined for one that names nothing here. */
export function instrumentLinkOf(url: string): InstrumentLink | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  // The scheme is not one the parser knows, so it leaves the host's case
  // alone; a noun is the same noun however a reply capitalized it.
  const host = parsed.host.toLowerCase();
  if (!SCHEMES.has(parsed.protocol) || !isHost(host)) {
    return undefined;
  }
  const { kind, prefix } = HOSTS[host];
  const segments = parsed.pathname.split("/").filter(Boolean);
  const name = segments[0] === undefined ? undefined : decoded(segments[0]);
  if (segments.length > 1 || (name !== undefined && !NAME.test(name))) {
    return undefined;
  }
  // Every noun names one thing and is nothing without it.
  if (name === undefined) {
    return undefined;
  }
  return { href: `${prefix}/${name}`, kind, name };
}

/**
 * The address that names what a screen href shows, as the released app
 * answers to it, for handing to someone outside the window. Undefined for a
 * screen no address names.
 */
export function instrumentUrlOf(href: string): string | undefined {
  const pathname = new URL(href, "http://tabs").pathname;
  for (const [host, { prefix }] of Object.entries(HOSTS)) {
    if (pathname === prefix) {
      return undefined;
    }
    if (pathname.startsWith(`${prefix}/`)) {
      const name = decoded(pathname.slice(prefix.length + 1));
      return NAME.test(name) ? `${APP_NAME_SLUG}://${host}/${name}` : undefined;
    }
  }
  return undefined;
}

/**
 * A path segment as it was written, whichever way it reached here. The
 * router writes a skill's colon as `%3A` into a screen href, and a name is
 * the same name either way; what is not valid encoding is taken as written.
 */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
