/**
 * What can be learned about a way in before the user is asked to use it, so
 * `app new` refuses a set-up that cannot work instead of handing the user a
 * card that fails on the first press. Each check answers "unknown" when the
 * network or the server does not say, and only a clear "no" refuses: a
 * check that cannot reach a server is no evidence against it.
 */

const CHECK_TIMEOUT_MS = 8000;

/**
 * Whether a hosted MCP server's sign-in lets a client register itself, which
 * is the only kind the sign-in card can be: `registers` when its
 * authorization server publishes a registration endpoint, `needs-client` when
 * it publishes metadata without one (only clients the vendor issued ahead of
 * time sign in), `open` when the server answers without any sign-in.
 */
export async function mcpSignInSupport(
  url: string,
): Promise<"needs-client" | "open" | "registers" | "unknown"> {
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "instrument-preflight", version: "0" },
          protocolVersion: "2025-06-18",
        },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch {
    return "unknown";
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) {
    return "open";
  }
  if (response.status !== 401) {
    return "unknown";
  }
  const server = new URL(url);
  const resourceUrl =
    /resource_metadata="([^"]+)"/.exec(
      response.headers.get("www-authenticate") ?? "",
    )?.[1] ??
    `${server.origin}/.well-known/oauth-protected-resource${trimmedPath(server)}`;
  const resource = await getJson(resourceUrl);
  const issuer =
    firstString(resource?.["authorization_servers"]) ?? server.origin;
  const metadata = await authorizationServerMetadata(issuer);
  if (metadata === undefined) {
    return "unknown";
  }
  return typeof metadata["registration_endpoint"] === "string"
    ? "registers"
    : "needs-client";
}

/**
 * Whether a package a local server would be installed from exists: npm's
 * registry for node, PyPI for python. A name the registry has never heard of
 * is one the agent made up.
 */
export async function packageExists(
  name: string,
  runtime: "node" | "python",
): Promise<"exists" | "missing" | "unknown"> {
  const url =
    runtime === "node"
      ? `https://registry.npmjs.org/${name.replace("/", "%2F")}`
      : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok
      ? "exists"
      : response.status === 404
        ? "missing"
        : "unknown";
  } catch {
    return "unknown";
  }
}

async function authorizationServerMetadata(
  issuer: string,
): Promise<Record<string, unknown> | undefined> {
  let base: URL;
  try {
    base = new URL(issuer);
  } catch {
    return undefined;
  }
  const path = trimmedPath(base);
  for (const candidate of [
    `${base.origin}/.well-known/oauth-authorization-server${path}`,
    `${base.origin}/.well-known/openid-configuration${path}`,
    `${base.origin}${path}/.well-known/openid-configuration`,
  ]) {
    const metadata = await getJson(candidate);
    if (typeof metadata?.["authorization_endpoint"] === "string") {
      return metadata;
    }
  }
  return undefined;
}

async function getJson(
  url: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const body: unknown = await response.json();
    return isRecord(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === "string"
    ? value[0]
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedPath(url: URL): string {
  return url.pathname.replace(/\/+$/, "");
}
