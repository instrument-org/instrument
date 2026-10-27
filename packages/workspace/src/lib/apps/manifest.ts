import { APP_NAME } from "@instrument-org/shared";
import { createHash } from "node:crypto";
import { omit } from "radashi";
import { z } from "zod";

import { MAC_APPS } from "../mac-apps/apps";

// An app's `id` is its identity everywhere (the `app` command, the connection
// record, the credential store, the UI), so keep it to a safe, predictable
// set.
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
 * Strict objects throughout: the manifest is written and repaired by agents,
 * and a silently stripped unknown key ("headers" vs "defaultHeaders") sends
 * them guessing. An unrecognized-key error is the feedback loop. A key the
 * front matter holds that none of these names is the person's own note or
 * another build's, and never reaches here (`AppFile.others`).
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
  // Authorization: Bearer <access token>, from a sign-in in the browser with
  // the client the directory has for the app's service, refreshed as it
  // expires. No key is stored.
  z.strictObject({ kind: z.literal("oauth") }),
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

/** Whether `spec` is one package to fetch for `runtime`, or for `bundled` one of the servers the app ships. */
function isPackageFor(runtime: "bundled" | "node" | "python", spec: string) {
  return runtime === "bundled"
    ? MAC_APPS.some((app) => app.server === spec)
    : PACKAGE_SPEC[runtime].test(spec);
}

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

// An "api" app: authenticated HTTP requests through `instrument app request`.
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
  // Static, non-secret headers sent with every request (e.g. Notion-Version).
  // The auth binding wins on conflicts. Secrets never belong here; the secret
  // scan the test runs is what catches one.
  headers: z.record(z.string(), z.string()).optional(),
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
  // The base every request's path is relative to.
  url: z.string().refine(isAllowedBaseUrl, {
    message:
      "url must be a valid https:// base URL (http:// is allowed only for loopback hosts) with no embedded credentials",
  }),
});

export type ApiAppManifest = z.output<typeof ApiAppManifestSchema>;

// An "mcp" app: tools discovered and called on a hosted MCP server
// (Streamable HTTP) through `instrument app tools` and `instrument app call`.
const McpAppManifestSchema = z.strictObject({
  account: AccountSchema,
  auth: McpAuthSchema,
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
// carries, or, with runtime "bundled", one of the servers the app ships
// (the Mac's own apps), named by `package`. Tools are discovered and called
// exactly as a hosted server's are.
const LocalMcpAppManifestSchema = z
  .strictObject({
    account: AccountSchema,
    // Arguments the server itself takes, after its own name.
    args: z.array(z.string()).optional(),
    auth: LocalMcpAuthSchema,
    // The bundle identifier of the Mac app the server drives, when it drives
    // one ("com.agiletortoise.Drafts-OSX"). A server that runs here has no
    // site to draw, so the app is drawn with that app's own icon.
    macApp: z
      .string()
      .regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/, {
        message:
          'macApp must be a bundle identifier, like "com.apple.Notes"; `plutil -extract CFBundleIdentifier raw /Applications/<App>.app/Contents/Info.plist` prints one.',
      })
      .optional(),
    package: z.string().min(1),
    runtime: z.enum(["bundled", "node", "python"]),
    service: ServiceSchema,
    type: z.literal("mcp-local"),
  })
  .refine((value) => isPackageFor(value.runtime, value.package), {
    message: `package must be one package to install: an npm name for the node runtime ("@scope/name", optionally "@version"), a PyPI name for python, or for bundled one of ${MAC_APPS.map((app) => app.server).join(", ")}. Paths, flags, and shell characters are refused; put arguments in "args".`,
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
 * A local app's manifest with any `env` left out. Its server runs outside
 * the sandbox and its environment is the app's to set: a variable such as
 * `NODE_OPTIONS` would load code from wherever the manifest's author
 * pointed it. A manifest that names one still loads, without it, and hashes
 * as one that never did, so an approval given with it no longer matches and
 * the person is asked again.
 */
function withoutRetiredKeys(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("type" in value) ||
    value.type !== "mcp-local" ||
    !("env" in value)
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "env"),
  );
}

/**
 * What an app folder's manifest describes: how to call a service, and nothing
 * about whether it may be called. Whether it may is the connection record,
 * which the app keeps where the agent cannot write it.
 */
export const AppManifestSchema = z.preprocess(
  withoutRetiredKeys,
  z.discriminatedUnion("type", [
    ApiAppManifestSchema,
    LocalMcpAppManifestSchema,
    McpAppManifestSchema,
    WebAppManifestSchema,
  ]),
);

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
 * guessing game. Each is the front matter of an app's `APP.md`, whose folder
 * is the app's name and whose body is its guide.
 *
 * There is no name key: the folder is the name. The `id` is what the `app`
 * command, the stored key, and the connection record all name the app by.
 */
export const APP_MANIFEST_EXAMPLE = `MCP app (tools on a hosted MCP server; "oauth" means a one-click sign-in in the browser, no key), in Apps/Linear/APP.md:
---
id: linear
type: mcp
url: https://mcp.linear.app/mcp
auth:
  kind: oauth
---

Local MCP app (an MCP server that runs on this machine, installed from npm ("node") or PyPI ("python")), in Apps/Drafts/APP.md:
---
id: drafts
type: mcp-local
package: "@agiletortoise/drafts-mcp-server"
runtime: node
macApp: com.agiletortoise.Drafts-OSX
auth:
  kind: none
---

API app (authenticated HTTP requests; auth kinds: bearer, basic (optionally with "user"), header (with "header"), query (with "param"), none), in Apps/Notion/APP.md:
---
id: notion
type: api
url: https://api.notion.com/v1
auth:
  kind: bearer
headers:
  Notion-Version: 2022-06-28
test:
  path: /users/me
---

Web app (a service worked on its own site in ${APP_NAME}'s browser, for one with no sign-in the card can open; "signIn" is optional, the login page when it is not "url"), in Apps/Google Drive/APP.md:
---
id: google-drive
type: web
url: https://drive.google.com
---`;

/**
 * A digest of the manifest as parsed, so a connection record can say which
 * manifest passed the test and a call can refuse one edited since. Over the
 * parsed value rather than the file's bytes, so rewriting the front matter is
 * not a change, and over the keys this build knows, so a note the person
 * added never disconnects the app. A local app's `macApp` is left out: it
 * only says which icon the app is drawn with, and naming one changes nothing
 * that runs or is sent, and its retired `env` with it. Nor is any app's
 * `account`, a label for the account it is signed in as, or its `service`,
 * which says what it is rather than how it is reached.
 *
 * Takes a loose record as well as a parsed manifest, so the migration can
 * digest the manifest an older build wrote and find the approval given for
 * it (`lib/apps-move.ts`).
 */
export function manifestHash(manifest: Record<string, unknown>): string {
  const reached =
    manifest.type === "mcp-local"
      ? omit(manifest, ["account", "env", "macApp", "service"])
      : omit(manifest, ["account", "service"]);
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(reached)))
    .digest("hex")
    .slice(0, 32);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}
