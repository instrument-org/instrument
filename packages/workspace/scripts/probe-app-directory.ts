/**
 * Walks every hosted MCP server the app directory lists and asks each how a
 * client signs in to it, the way the sign-in card would: the server's
 * protected-resource metadata, then its authorization server's. A server the
 * directory marks `auth: "oauth"` is one the card registers a client with on
 * the spot, so one that no longer advertises a registration endpoint or
 * client ID metadata documents (CIMD) will fail at the card; those are
 * reported, along with every server that could not be read. A report for a
 * person to act on, never a test: it reaches the network.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:probe-app-directory [--json] [--only <slug>,<slug>]
 */

import { parseArgs } from "node:util";

import { getAppCatalog } from "../src/lib/apps/catalog";

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;

const { values } = parseArgs({
  options: {
    json: { type: "boolean" },
    only: { type: "string" },
  },
});

/** How one server answered, as far as the probe got. */
type Finding =
  /** It lets a client register on the spot, or names itself by a metadata document. */
  | { kind: "registers"; how: ("cimd" | "dcr")[] }
  /** Its authorization server publishes metadata with neither. */
  | { kind: "no-registration"; issuer: string }
  /** It answered `initialize` with no sign-in at all. */
  | { kind: "open" }
  /** A step could not be read: what, and what came back. */
  | { kind: "unreadable"; step: string; said: string };

interface Row {
  auth: string | undefined;
  endpoint: string;
  finding: Finding;
  slug: string;
}

const only = values.only?.split(",").map((slug) => slug.trim());
const servers = getAppCatalog()
  .filter((entry) => only === undefined || only.includes(entry.slug))
  .flatMap((entry) =>
    entry.interfaces.flatMap((surface) =>
      surface.format === "mcp" && surface.endpoint !== undefined
        ? [{ auth: surface.auth, endpoint: surface.endpoint, slug: entry.slug }]
        : [],
    ),
  );

const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < servers.length) {
      const server = servers[next++];
      if (server) {
        rows.push({ ...server, finding: await probe(server.endpoint) });
      }
    }
  }),
);
rows.sort((a, b) => a.slug.localeCompare(b.slug));

const expectsRegistration = rows.filter((row) => row.auth === "oauth");
const flagged = expectsRegistration.filter(
  (row) => row.finding.kind === "no-registration",
);
const openAnyway = expectsRegistration.filter(
  (row) => row.finding.kind === "open",
);
const unreadable = rows.filter((row) => row.finding.kind === "unreadable");

if (values.json) {
  console.log(JSON.stringify({ flagged, openAnyway, rows, unreadable }));
} else {
  const line = (row: Row) => `  ${row.slug}  ${row.endpoint}  ${describe(row)}`;
  console.log(
    `${servers.length} hosted MCP servers; ${expectsRegistration.length} marked oauth (a client registers on the spot).`,
  );
  console.log(
    `\nMarked oauth, but no registration endpoint or CIMD (${flagged.length}):`,
  );
  console.log(flagged.map(line).join("\n") || "  none");
  console.log(
    `\nMarked oauth, but answered with no sign-in (${openAnyway.length}):`,
  );
  console.log(openAnyway.map(line).join("\n") || "  none");
  console.log(`\nCould not be read (${unreadable.length}):`);
  console.log(unreadable.map(line).join("\n") || "  none");
}

function describe(row: Row): string {
  const { finding } = row;
  switch (finding.kind) {
    case "no-registration": {
      return `(auth: ${row.auth ?? "unset"}; issuer ${finding.issuer})`;
    }
    case "open": {
      return `(auth: ${row.auth ?? "unset"}; initialize answered without a sign-in)`;
    }
    case "registers": {
      return `(${finding.how.join(", ")})`;
    }
    case "unreadable": {
      return `(auth: ${row.auth ?? "unset"}; ${finding.step}: ${finding.said})`;
    }
  }
}

/**
 * What a server says about signing in, read the way the MCP SDK reads it: a
 * 401 to `initialize`, its `resource_metadata` (or the well-known address),
 * then the authorization server's metadata at each address the spec allows.
 */
async function probe(endpoint: string): Promise<Finding> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "instrument-directory-probe", version: "0" },
          protocolVersion: "2025-06-18",
        },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "unreadable", said: said(error), step: "initialize" };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) {
    return { kind: "open" };
  }
  if (response.status !== 401) {
    return {
      kind: "unreadable",
      said: `HTTP ${response.status}`,
      step: "initialize",
    };
  }
  const server = new URL(endpoint);
  const path = server.pathname.replace(/\/+$/, "");
  const named = /resource_metadata="([^"]+)"/.exec(
    response.headers.get("www-authenticate") ?? "",
  )?.[1];
  const resource = await firstJson([
    ...(named ? [named] : []),
    `${server.origin}/.well-known/oauth-protected-resource${path}`,
    `${server.origin}/.well-known/oauth-protected-resource`,
  ]);
  const issuer =
    (Array.isArray(resource?.["authorization_servers"]) &&
    typeof resource["authorization_servers"][0] === "string"
      ? resource["authorization_servers"][0]
      : undefined) ?? server.origin;
  const base = URL.parse(issuer);
  if (base === null) {
    return { kind: "unreadable", said: issuer, step: "issuer" };
  }
  const issuerPath = base.pathname.replace(/\/+$/, "");
  const metadata = await firstJson(
    [
      `${base.origin}/.well-known/oauth-authorization-server${issuerPath}`,
      `${base.origin}/.well-known/openid-configuration${issuerPath}`,
      `${base.origin}${issuerPath}/.well-known/openid-configuration`,
    ],
    (body) => typeof body["authorization_endpoint"] === "string",
  );
  if (metadata === undefined) {
    return {
      kind: "unreadable",
      said: `no metadata for ${issuer}${resource === undefined ? " (and no protected-resource metadata)" : ""}`,
      step: "authorization server",
    };
  }
  const how: ("cimd" | "dcr")[] = [
    ...(typeof metadata["registration_endpoint"] === "string"
      ? (["dcr"] as const)
      : []),
    ...(metadata["client_id_metadata_document_supported"] === true
      ? (["cimd"] as const)
      : []),
  ];
  return how.length > 0
    ? { how, kind: "registers" }
    : { issuer, kind: "no-registration" };
}

/** The first address that answers with a JSON object passing `accepts`. */
async function firstJson(
  urls: string[],
  accepts: (body: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown> | undefined> {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      const body: unknown = await response.json();
      if (
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        accepts(Object.fromEntries(Object.entries(body)))
      ) {
        return Object.fromEntries(Object.entries(body));
      }
    } catch {
      // The next address, or nothing.
    }
  }
  return undefined;
}

function said(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}
