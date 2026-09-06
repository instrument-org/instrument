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
 * Non-loopback private ranges are rejected at request time per hop; this only
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
const ApiAppManifestSchema = z.strictObject({
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
  type: z.literal("api"),
});

export type ApiAppManifest = z.output<typeof ApiAppManifestSchema>;

// An "mcp" app: tools discovered and called on a hosted MCP server
// (Streamable HTTP) through `app tools` and `app call`.
const McpAppManifestSchema = z.strictObject({
  auth: McpAuthSchema,
  name: z.string().min(1),
  type: z.literal("mcp"),
  url: z.string().refine(isAllowedBaseUrl, {
    message:
      "url must be a valid https:// MCP server URL (http:// is allowed only for loopback hosts)",
  }),
});

export type McpAppManifest = z.output<typeof McpAppManifestSchema>;

/**
 * What an app folder's manifest describes: how to call a service, and nothing
 * about whether it may be called. Whether it may is the connection record,
 * which the app keeps where the agent cannot write it.
 */
export const AppManifestSchema = z.discriminatedUnion("type", [
  ApiAppManifestSchema,
  McpAppManifestSchema,
]);

export type AppManifest = z.output<typeof AppManifestSchema>;

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

API app (authenticated HTTP requests; auth kinds: bearer, header (with "header"), query (with "param"), none):
{
  "name": "Notion",
  "type": "api",
  "baseUrl": "https://api.notion.com/v1",
  "auth": { "kind": "bearer" },
  "headers": { "Notion-Version": "2022-06-28" },
  "test": { "path": "/users/me" }
}`;
