import { APP_NAME_SLUG, APP_PROTOCOL } from "@instrument-org/shared";

/** What an `instrument://` address names, and where in the window that is. */
export interface InstrumentLink {
  /** The screen address the window opens it at. */
  href: string;
  kind: InstrumentLinkKind;
  /** The thing's own name: a slug, a task id, a session id or its prefix. */
  name: string;
}

/**
 * The things inside the app an address can name, by the noun the address
 * leads with. Each is a kind of thing a reply mentions and a person can be
 * taken to, and the noun is the one the agent's own commands use for it.
 */
export type InstrumentLinkKind =
  | "app"
  | "idea"
  | "ideas"
  | "memory"
  | "skill"
  | "task"
  | "thread";

/**
 * The nouns an address may lead with, each with the screen prefix its thing
 * lives under. `discover` is the website's word for the Ideas screen and
 * stays as the site wrote it into its "Try in Instrument" links.
 */
const HOSTS = {
  app: { kind: "app", prefix: "/orchestrator/apps" },
  discover: { kind: "idea", prefix: "/orchestrator/ideas" },
  memory: { kind: "memory", prefix: "/orchestrator/memory" },
  skill: { kind: "skill", prefix: "/orchestrator/skills" },
  task: { kind: "task", prefix: "/orchestrator/tasks" },
  thread: { kind: "thread", prefix: "/orchestrator/threads" },
} as const satisfies Record<
  string,
  { kind: InstrumentLinkKind; prefix: string }
>;

type Host = keyof typeof HOSTS;

const isHost = (host: string): host is Host => host in HOSTS;

/**
 * A name as it may appear in an address: one path segment of the characters
 * every kind's names are made of. What it names is the opener's question; a
 * deleted memory or a task from a thread since closed is still an address.
 */
const NAME = /^[\w.-]+$/;

/**
 * The scheme the app answers to. The build's own protocol is what the OS
 * hands over, and the released app's is what a reply writes: a link the
 * agent wrote in a development build reads the same as one in a release.
 */
const SCHEMES = new Set([`${APP_NAME_SLUG}:`, `${APP_PROTOCOL}:`]);

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
  const name = segments[0];
  if (segments.length > 1 || (name !== undefined && !NAME.test(name))) {
    return undefined;
  }
  if (name === undefined) {
    // Only the Ideas screen is a place on its own; every other noun names
    // one thing and is nothing without it.
    return kind === "idea"
      ? { href: prefix, kind: "ideas", name: "" }
      : undefined;
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
      return host === "discover" ? `${APP_NAME_SLUG}://${host}` : undefined;
    }
    if (pathname.startsWith(`${prefix}/`)) {
      const name = pathname.slice(prefix.length + 1);
      return NAME.test(name) ? `${APP_NAME_SLUG}://${host}/${name}` : undefined;
    }
  }
  return undefined;
}
