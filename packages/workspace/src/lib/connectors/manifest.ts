import { z } from "zod";

export const CONNECTOR_MANIFEST_FILE_NAME = "connector.json";
export const CONNECTOR_GUIDE_FILE_NAME = "guide.md";

// Folder names under connectors/ double as the connector's identity everywhere
// (tools, credential store keys, UI), so keep them to a safe, predictable set.
export const ConnectorSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Slug must be lowercase letters, digits, and hyphens",
  )
  .brand("ConnectorSlug");

export type ConnectorSlug = z.output<typeof ConnectorSlugSchema>;

/**
 * How the stored credential is attached to each request. The credential value
 * itself never appears in the manifest -- it lives in the app's encrypted
 * credential store and is injected at request time, keyed by the connector's
 * slug.
 *
 * Strict objects throughout: connector manifests are written and repaired by
 * agents, and a silently-stripped unknown key ("headers" vs "defaultHeaders")
 * sends them guessing. An unrecognized-key error is the feedback loop.
 */
const ConnectorAuthSchema = z.discriminatedUnion("kind", [
  // Authorization: Bearer <credential>
  z.strictObject({ kind: z.literal("bearer") }),
  // <header>: <credential>  (e.g. X-Api-Key)
  z.strictObject({ header: z.string().min(1), kind: z.literal("header") }),
  // No credential required.
  z.strictObject({ kind: z.literal("none") }),
  // ?<param>=<credential>
  z.strictObject({ kind: z.literal("query"), param: z.string().min(1) }),
]);

export type ConnectorAuth = z.output<typeof ConnectorAuthSchema>;

/**
 * Auth for MCP connectors. Same credential-injection idea as API auth, minus
 * `query` (MCP is header-authenticated) and plus `oauth`, which has no stored
 * key at all.
 */
const McpConnectorAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bearer") }),
  z.strictObject({ header: z.string().min(1), kind: z.literal("header") }),
  z.strictObject({ kind: z.literal("none") }),
  // Interactive OAuth: the user signs in via the browser once, no API key.
  // The MCP server's OAuth metadata + dynamic client registration are handled
  // by the SDK; `scope` optionally narrows the requested grants.
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

// An "api" connector: authenticated HTTP requests through connector_request.
const ApiConnectorManifestSchema = z.strictObject({
  auth: ConnectorAuthSchema,
  baseUrl: z.string().refine(isAllowedBaseUrl, {
    message:
      "baseUrl must be a valid https:// URL (http:// is allowed only for loopback hosts) with no embedded credentials",
  }),
  displayName: z.string().min(1),
  // Flipped to true by a passing connector test; request tool refuses while
  // false. Not a trust boundary: the manifest sits in a writable mount, so an
  // agent can set this itself and skip the test (see
  // docs/findings/connector-enabled-flag-is-agent-writable.md).
  enabled: z.boolean(),
  // Static, non-secret headers sent with every request (e.g. Notion-Version).
  // The auth binding wins on conflicts, and secrets never belong here -- but
  // the only thing checking for one is the secret scan the connector test runs,
  // which self-enabling skips.
  headers: z.record(z.string(), z.string()).optional(),
  // Canary the connector test uses to verify auth + connectivity. Defaults to
  // GET; set method + body for APIs whose only cheap auth check is a POST
  // (e.g. a GraphQL `viewer` query). A 2xx enables the connector.
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

export type ApiConnectorManifest = z.output<typeof ApiConnectorManifestSchema>;

// An "mcp" connector: tools discovered and called on a hosted MCP server
// (Streamable HTTP) via the connector_mcp tool.
const McpConnectorManifestSchema = z.strictObject({
  auth: McpConnectorAuthSchema,
  displayName: z.string().min(1),
  enabled: z.boolean(),
  type: z.literal("mcp"),
  url: z.string().refine(isAllowedBaseUrl, {
    message:
      "url must be a valid https:// MCP server URL (http:// is allowed only for loopback hosts)",
  }),
});

export type McpConnectorManifest = z.output<typeof McpConnectorManifestSchema>;

export const ConnectorManifestSchema = z.discriminatedUnion("type", [
  ApiConnectorManifestSchema,
  McpConnectorManifestSchema,
]);

export type ConnectorManifest = z.output<typeof ConnectorManifestSchema>;

/**
 * Canonical manifests shown to the agent in the connector_test description and
 * in manifest-validation failures, so a broken manifest is a one-round fix
 * instead of a guessing game.
 */
export const CONNECTOR_MANIFEST_EXAMPLE = `API connector:
{
  "displayName": "Notion",
  "type": "api",
  "enabled": false,
  "baseUrl": "https://api.notion.com/v1",
  "auth": { "kind": "bearer" },
  "headers": { "Notion-Version": "2022-06-28" },
  "test": { "path": "/users/me" }
}

MCP connector (tools on a hosted MCP server). auth.kind may be bearer/header/
none, or "oauth" for one-click browser sign-in (no API key -- the user connects
it from Settings):
{
  "displayName": "Linear",
  "type": "mcp",
  "enabled": false,
  "url": "https://mcp.linear.app/mcp",
  "auth": { "kind": "oauth" }
}`;
