import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

export const APP_MANIFEST_FILE_NAME = "app.json";
export const APP_GUIDE_FILE_NAME = "guide.md";

// Folder names under apps/ double as the app's identity everywhere (the `app`
// command, the connection record, the credential store, the UI), so keep them
// to a safe, predictable set.
export const AppSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Slug must be lowercase letters, digits, and hyphens",
  )
  .brand("AppSlug");

export type AppSlug = z.output<typeof AppSlugSchema>;

/**
 * How the stored credential is attached to each request. The credential value
 * itself never appears in the manifest: it lives in the app's encrypted
 * credential store and is injected at request time, keyed by the app's slug.
 *
 * Strict objects throughout: manifests are written and repaired by agents,
 * and a silently stripped unknown key ("headers" vs "defaultHeaders") sends
 * them guessing. An unrecognized-key error is the feedback loop.
 */
const ApiAuthSchema = z.discriminatedUnion("kind", [
  // Authorization: Basic base64(<user>:<credential>), or base64(<credential>)
  // with no "user". Both forms exist in the wild: a service that names a
  // username for its keys (Twilio) wants the first, and one that calls the key
  // itself the Basic credentials (WakaTime) wants the second. The encoding
  // happens here because nothing upstream can do it: the agent's shell has no
  // base64, and the user pastes the key as the service gave it to them.
  z.strictObject({
    kind: z.literal("basic"),
    user: z.string().min(1).optional(),
  }),
  // Authorization: Bearer <credential>
  z.strictObject({ kind: z.literal("bearer") }),
  // <header>: <credential>  (e.g. X-Api-Key)
  z.strictObject({ header: z.string().min(1), kind: z.literal("header") }),
  // No credential required.
  z.strictObject({ kind: z.literal("none") }),
  // ?<param>=<credential>
  z.strictObject({ kind: z.literal("query"), param: z.string().min(1) }),
]);

export type AppAuth = z.output<typeof ApiAuthSchema>;

/**
 * Auth for MCP apps. Same credential-injection idea as API auth, minus
 * `query` (MCP is header-authenticated) and plus `oauth`, which has no stored
 * key at all: the user signs in once in the browser.
 */
const McpAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bearer") }),
  z.strictObject({ header: z.string().min(1), kind: z.literal("header") }),
  z.strictObject({ kind: z.literal("none") }),
  // The MCP server's OAuth metadata and client registration are handled by
  // the SDK; `scope` optionally narrows the requested grants.
  z.strictObject({ kind: z.literal("oauth"), scope: z.string().optional() }),
]);

/**
 * Auth for a local MCP app. Most take none at all: the server runs on this
 * machine and reaches something the user is already signed in to. The ones
 * that need a key read it from the environment, which is where the stored
 * credential is injected at spawn time, never into the manifest.
 */
const LocalMcpAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    // e.g. GITHUB_TOKEN
    envVar: z.string().regex(/^[a-z_]\w*$/i, {
      message: "envVar must be an environment variable name",
    }),
    kind: z.literal("env"),
  }),
]);

/**
 * What may be installed and run, per ecosystem: a bare package name, scoped
 * for npm, optionally with a version or extras. Anything with a path
 * separator, a shell character, or a leading dash is refused, so the manifest
 * names a package to fetch from the registry and can never name a binary on
 * this machine or smuggle arguments into the install.
 */
const PACKAGE_SPEC = {
  node: /^(?:@[\da-z~][\w.~-]*\/)?[\da-z~][\w.~-]*(?:@[\d.^<>=~*x-]+)?$/i,
  python:
    /^[\da-z](?:[\w.-]*[\da-z])?(?:\[[\w,.-]+\])?(?:[!<=>~]=?[\w.*+-]+)?$/i,
} as const;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Only https, plus plain http for loopback hosts (local services, tests).
 * Each hop is checked again at request time (`checkAppUrl`); this only
 * validates the shape of the configured base.
 */
function isAllowedBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

// An "api" app: authenticated HTTP requests through `app request`.
/**
 * Which account of the service this app is signed in as, in the user's
 * words or the agent's ("jeremy@pileofturtles.com", "Acme workspace"), so
 * two apps for one service can be told apart. Only a label: it reaches
 * nothing and is left out of the manifest's hash.
 */
const AccountSchema = z.string().trim().min(1).max(120).optional();

// The directory's slug for the service the app reaches ("gmail"), so every
// app of one service, whatever its own slug, is known as that service.
const ServiceSchema = z.string().min(1).optional();

const ApiAppManifestSchema = z.strictObject({
  account: AccountSchema,
  auth: ApiAuthSchema,
  baseUrl: z.string().refine(isAllowedBaseUrl, {
    message:
      "baseUrl must be a valid https:// URL (http:// is allowed only for loopback hosts) with no embedded credentials",
  }),
  // Static, non-secret headers sent with every request (e.g. Notion-Version).
  // The auth binding wins on conflicts. Secrets never belong here; the secret
  // scan the test runs is what catches one.
  headers: z.record(z.string(), z.string()).optional(),
  name: z.string().min(1),
  // Canary the test uses to verify auth and connectivity. Defaults to GET;
  // set method and body for APIs whose only cheap auth check is a POST (e.g.
  // a GraphQL `viewer` query). A 2xx is a pass.
  test: z
    .strictObject({
      body: z.string().optional(),
      method: z.enum(["GET", "POST"]).optional(),
      path: z.string().min(1),
    })
    .refine((value) => value.body === undefined || value.method === "POST", {
      message:
        'test.body requires "method": "POST" (a GET canary cannot have a body)',
    }),
  service: ServiceSchema,
  type: z.literal("api"),
});

export type ApiAppManifest = z.output<typeof ApiAppManifestSchema>;

// An "mcp" app: tools discovered and called on a hosted MCP server
// (Streamable HTTP) through `app tools` and `app call`.
const McpAppManifestSchema = z.strictObject({
  account: AccountSchema,
  auth: McpAuthSchema,
  name: z.string().min(1),
  service: ServiceSchema,
  type: z.literal("mcp"),
  url: z.string().refine(isAllowedBaseUrl, {
    message:
      "url must be a valid https:// MCP server URL (http:// is allowed only for loopback hosts)",
  }),
});

export type McpAppManifest = z.output<typeof McpAppManifestSchema>;

// An "mcp-local" app: an MCP server that runs on this machine over stdio,
// installed from a package registry and launched with the runtime the app
// carries. Tools are discovered and called exactly as a hosted server's are.
const LocalMcpAppManifestSchema = z
  .strictObject({
    account: AccountSchema,
    // Arguments the server itself takes, after its own name.
    args: z.array(z.string()).optional(),
    auth: LocalMcpAuthSchema,
    // Static, non-secret environment for the process. The credential is never
    // one of these; the secret scan the test runs is what catches one.
    env: z.record(z.string(), z.string()).optional(),
    // The bundle identifier of the Mac app the server drives, when it drives
    // one ("com.agiletortoise.Drafts-OSX"). A server that runs here has no
    // site to draw, so the app is drawn with that app's own icon.
    macApp: z
      .string()
      .regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/, {
        message:
          'macApp must be a bundle identifier, like "com.apple.Notes"; `osascript -e \'id of app "Notes"\'` prints one.',
      })
      .optional(),
    name: z.string().min(1),
    package: z.string().min(1),
    runtime: z.enum(["node", "python"]),
    service: ServiceSchema,
    type: z.literal("mcp-local"),
  })
  .refine((value) => PACKAGE_SPEC[value.runtime].test(value.package), {
    message:
      'package must be one package to install: an npm name for the node runtime ("@scope/name", optionally "@version"), a PyPI name for python. Paths, flags, and shell characters are refused; put arguments in "args".',
    path: ["package"],
  });

export type LocalMcpAppManifest = z.output<typeof LocalMcpAppManifestSchema>;

// A "web" app: a service worked on its own website, in the window's browser,
// where the user signs in themselves. For a service whose every agent-usable
// way in waits on a sign-in client of the vendor's approving (Google Drive,
// Zoom) or that has none at all. No credential and no tools: connected means
// the user said they are signed in, and a task works the site in a tab.
const WebAppManifestSchema = z.strictObject({
  account: AccountSchema,
  name: z.string().min(1),
  // The page the sign-in opens, when it is not where the work happens.
  signIn: z
    .string()
    .refine(isAllowedBaseUrl, {
      message:
        "signIn must be a valid https:// URL (http:// is allowed only for loopback hosts) with no embedded credentials",
    })
    .optional(),
  service: ServiceSchema,
  type: z.literal("web"),
  // Where the work happens: the signed-in web app, e.g. https://drive.google.com.
  url: z.string().refine(isAllowedBaseUrl, {
    message:
      "url must be a valid https:// URL (http:// is allowed only for loopback hosts) with no embedded credentials",
  }),
});

export type WebAppManifest = z.output<typeof WebAppManifestSchema>;

/**
 * What an app folder's manifest describes: how to call a service, and nothing
 * about whether it may be called. Whether it may is the connection record,
 * which the app keeps where the agent cannot write it.
 */
export const AppManifestSchema = z.discriminatedUnion("type", [
  ApiAppManifestSchema,
  LocalMcpAppManifestSchema,
  McpAppManifestSchema,
  WebAppManifestSchema,
]);

export type AppManifest = z.output<typeof AppManifestSchema>;

/** An app reached by a request or a tool call, with an auth binding: every kind but a web app. */
export type CalledAppManifest = Exclude<AppManifest, WebAppManifest>;

/**
 * Whether the app speaks MCP, wherever its server runs. Both kinds discover
 * and call tools the same way, so everything but the connection itself treats
 * them alike.
 */
export function isMcpManifest(
  manifest: AppManifest,
): manifest is LocalMcpAppManifest | McpAppManifest {
  return manifest.type === "mcp" || manifest.type === "mcp-local";
}

/**
 * Canonical manifests shown to the agent in the command's help and in
 * validation failures, so a broken manifest is a one-round fix instead of a
 * guessing game.
 */
export const APP_MANIFEST_EXAMPLE = `MCP app (tools on a hosted MCP server; "oauth" means a one-click sign-in in the browser, no key):
{
  "name": "Linear",
  "type": "mcp",
  "url": "https://mcp.linear.app/mcp",
  "auth": { "kind": "oauth" }
}

Local MCP app (an MCP server that runs on this machine, installed from npm ("node") or PyPI ("python")):
{
  "name": "Drafts",
  "type": "mcp-local",
  "runtime": "node",
  "package": "@agiletortoise/drafts-mcp-server",
  "macApp": "com.agiletortoise.Drafts-OSX",
  "auth": { "kind": "none" }
}

API app (authenticated HTTP requests; auth kinds: bearer, basic (optionally with "user"), header (with "header"), query (with "param"), none):
{
  "name": "Notion",
  "type": "api",
  "baseUrl": "https://api.notion.com/v1",
  "auth": { "kind": "bearer" },
  "headers": { "Notion-Version": "2022-06-28" },
  "test": { "path": "/users/me" }
}

Web app (a service worked on its own site in ${APP_NAME}'s browser, for one with no sign-in the card can open; "signIn" is optional, the login page when it is not "url"):
{
  "name": "Google Drive",
  "type": "web",
  "url": "https://drive.google.com"
}`;
