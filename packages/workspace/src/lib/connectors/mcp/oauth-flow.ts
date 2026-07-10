import { APP_NAME } from "@instrument-org/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { err, ok, type Result } from "neverthrow";
import { noop } from "radashi";

import { type AbsolutePath } from "../../../schemas/paths";
import { loadConnector, setConnectorEnabled } from "../store";
import { type McpConnectionError } from "./client";
import { createMcpOAuthProvider, type McpOAuthStore } from "./oauth-provider";

/**
 * Interactive OAuth for MCP connectors, orchestrated here (the SDK lives in
 * this package) and driven by the desktop app, which supplies the browser-open
 * action, the encrypted token store, and the loopback callback. The SDK handles
 * OAuth metadata discovery, dynamic client registration (no app setup for
 * servers that support it), PKCE, and token exchange/refresh.
 *
 *   begin -> browser opens -> user approves -> callback -> complete
 *
 * The in-flight transport is parked here between `begin` and `complete`, keyed
 * by the OAuth `state`, so the desktop callback only needs to pass back
 * `{ state, code }`.
 */
interface PendingFlow {
  connectorsDir: AbsolutePath;
  expiresAt: number;
  provider: ReturnType<typeof createMcpOAuthProvider>;
  slug: string;
  store: McpOAuthStore;
  // The transport that started the flow -- it holds the auth state finishAuth
  // needs. The working connection uses a FRESH transport (a started transport
  // can't be started again).
  transport: StreamableHTTPClientTransport;
  url: string;
}

// A sign-in the user never finishes (declined, closed the browser) would
// otherwise leak a transport forever. Evict parked flows after this long.
const PENDING_FLOW_TTL_MS = 10 * 60 * 1000;

const pendingFlows = new Map<string, PendingFlow>();

export async function beginMcpOAuth({
  connectorsDir,
  openAuthorization,
  redirectUrl,
  slug,
  store,
}: {
  connectorsDir: AbsolutePath;
  openAuthorization: (url: URL) => Promise<void> | void;
  redirectUrl: string;
  slug: string;
  store: McpOAuthStore;
}): Promise<
  Result<{ alreadyConnected: boolean; state?: string }, McpConnectionError>
> {
  const now = Date.now();
  evictExpiredFlows(now);

  const loaded = await loadConnector(connectorsDir, slug);
  if (loaded.isErr()) {
    return err({ message: loaded.error.message, reason: "connect" });
  }
  const manifest = loaded.value.manifest;
  if (manifest.type !== "mcp" || manifest.auth.kind !== "oauth") {
    return err({
      message: `Connector "${slug}" is not an OAuth MCP connector.`,
      reason: "connect",
    });
  }

  // Supersede any in-flight sign-in for this connector, and clear stale PKCE
  // material so this flow starts clean.
  dropPendingFlowsForSlug(slug);
  await store.clearTransient(slug);

  // Track whether the SDK actually opened the browser. If connect throws for a
  // reason *other* than needing authorization (e.g. a network error, or a
  // refresh that failed without falling through to re-auth), no browser opened
  // and we must surface an error instead of parking a flow that can never
  // complete.
  // A holder object (not a bare `let`) so control-flow analysis doesn't narrow
  // the value to the literal `false` and flag the later check as unreachable.
  const opened = { browser: false };
  const provider = createMcpOAuthProvider({
    openAuthorization: async (url) => {
      opened.browser = true;
      await openAuthorization(url);
    },
    redirectUrl,
    scope: manifest.auth.scope,
    slug,
    store,
  });
  const transport = new StreamableHTTPClientTransport(new URL(manifest.url), {
    authProvider: provider,
  });
  const client = new Client({ name: APP_NAME, version: "1.0.0" });

  try {
    // If we already hold a valid token, this succeeds outright.
    await client.connect(transport);
    await client.close().catch(noop);
    // Enable it now if a prior sign-in left it disabled -- it demonstrably works.
    if (!manifest.enabled) {
      await setConnectorEnabled(loaded.value, true);
    }
    return ok({ alreadyConnected: true });
  } catch (error) {
    await client.close().catch(noop);
    if (!opened.browser) {
      await transport.close().catch(noop);
      return err({
        message: `Could not start sign-in for "${slug}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        reason: "connect",
      });
    }
    const state = await store.getState(slug);
    if (state === undefined) {
      await transport.close().catch(noop);
      return err({
        message:
          "OAuth flow did not produce a state parameter; the MCP server may not support authorization.",
        reason: "unauthorized",
      });
    }
    pendingFlows.set(state, {
      connectorsDir,
      expiresAt: now + PENDING_FLOW_TTL_MS,
      provider,
      slug,
      store,
      transport,
      url: manifest.url,
    });
    return ok({ alreadyConnected: false, state });
  }
}

/**
 * Abandon a parked flow (the user denied authorization or closed the browser,
 * so the callback arrives with an error and no code). Closes the transport and
 * clears transient PKCE material. Safe to call for an unknown state.
 */
export async function cancelMcpOAuth(state: string): Promise<void> {
  const flow = pendingFlows.get(state);
  if (!flow) {
    return;
  }
  pendingFlows.delete(state);
  await flow.transport.close().catch(noop);
  await flow.store.clearTransient(flow.slug).catch(noop);
}

export async function completeMcpOAuth({
  code,
  state,
}: {
  code: string;
  state: string;
}): Promise<Result<{ slug: string; toolCount: number }, McpConnectionError>> {
  const flow = pendingFlows.get(state);
  if (!flow) {
    return err({
      message:
        "No pending OAuth flow matches this callback (it may have expired or been superseded).",
      reason: "unauthorized",
    });
  }
  pendingFlows.delete(state);

  // finishAuth on the original transport exchanges the code for tokens (saved
  // via the provider). The original transport is already started, so the
  // working session uses a fresh transport + client that connect with the now-
  // stored token.
  const client = new Client({ name: APP_NAME, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(flow.url), {
    authProvider: flow.provider,
  });
  try {
    await flow.transport.finishAuth(code);
    await client.connect(transport);
    const tools = await client.listTools();
    const loaded = await loadConnector(flow.connectorsDir, flow.slug);
    if (loaded.isErr()) {
      return err({
        message: `Signed in, but connector "${flow.slug}" no longer exists.`,
        reason: "connect",
      });
    }
    // The connect + list proves the connector works, so enable it now -- the
    // user shouldn't have to run a separate test after signing in.
    if (!loaded.value.manifest.enabled) {
      await setConnectorEnabled(loaded.value, true);
    }
    return ok({ slug: flow.slug, toolCount: tools.tools.length });
  } catch (error) {
    return err({
      message: error instanceof Error ? error.message : String(error),
      reason: "unauthorized",
    });
  } finally {
    // The one-time PKCE material has served its purpose; drop it so it can't
    // corrupt a later sign-in. Tokens + client registration stay.
    await flow.store.clearTransient(flow.slug).catch(noop);
    await client.close().catch(noop);
    await flow.transport.close().catch(noop);
  }
}

function dropPendingFlowsForSlug(slug: string): void {
  // A new sign-in for a connector supersedes any in-flight one: close the old
  // transport and clear its pending entry so a stale browser tab resolves to a
  // clean "no pending flow" error instead of a PKCE mismatch.
  for (const [state, flow] of pendingFlows) {
    if (flow.slug === slug) {
      void flow.transport.close().catch(noop);
      pendingFlows.delete(state);
    }
  }
}

function evictExpiredFlows(now: number): void {
  for (const [state, flow] of pendingFlows) {
    if (flow.expiresAt <= now) {
      void flow.transport.close().catch(noop);
      pendingFlows.delete(state);
    }
  }
}
