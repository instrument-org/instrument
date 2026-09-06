import { APP_NAME } from "@instrument-org/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { err, ok, type Result } from "neverthrow";
import { noop } from "radashi";

import { type AbsolutePath } from "../../../schemas/paths";
import { recordConnection } from "../connection";
import { loadApp } from "../store";
import { type McpConnectionError } from "./client";
import { createMcpOAuthProvider, type McpOAuthStore } from "./oauth-provider";

/**
 * Interactive OAuth for MCP apps, orchestrated here (the SDK lives in this
 * package) and driven by the desktop app, which supplies the encrypted token
 * store, the loopback callback, and the browser the authorization page opens
 * in. The SDK handles OAuth metadata discovery, dynamic client registration
 * (no app setup for servers that support it), PKCE, and token exchange and
 * refresh.
 *
 *   begin -> the authorization URL -> the user approves -> callback -> complete
 *
 * The in-flight transport is parked here between `begin` and `complete`,
 * keyed by the OAuth `state`, so the callback only needs `{ state, code }`.
 */
/** Where the authorization page was opened: the window's own browser, or the user's. */
export type SignInOpensIn = "app" | "external";

interface PendingFlow {
  appsDir: AbsolutePath;
  expiresAt: number;
  opensIn: SignInOpensIn;
  provider: ReturnType<typeof createMcpOAuthProvider>;
  slug: string;
  store: McpOAuthStore;
  // The transport that started the flow: it holds the auth state finishAuth
  // needs. The working connection uses a fresh transport, since a started
  // transport cannot be started again.
  transport: StreamableHTTPClientTransport;
  url: string;
}

// A sign-in the user never finishes (declined, closed the tab) would otherwise
// leak a transport forever. Evict parked flows after this long.
const PENDING_FLOW_TTL_MS = 10 * 60 * 1000;

const pendingFlows = new Map<string, PendingFlow>();

/**
 * Start a sign-in. Hands back the authorization URL rather than opening it,
 * because where it opens is the caller's call: the window's own browser when
 * there is one, the system browser otherwise.
 */
export async function beginMcpOAuth({
  appsDir,
  opensIn = "app",
  redirectUrl,
  slug,
  store,
}: {
  appsDir: AbsolutePath;
  opensIn?: SignInOpensIn;
  redirectUrl: string;
  slug: string;
  store: McpOAuthStore;
}): Promise<
  Result<
    | { alreadyConnected: false; authorizationUrl: string; state: string }
    | { alreadyConnected: true },
    McpConnectionError
  >
> {
  const now = Date.now();
  evictExpiredFlows(now);

  const loaded = await loadApp(appsDir, slug);
  if (loaded.isErr()) {
    return err({ message: loaded.error.message, reason: "connect" });
  }
  const { manifest, manifestHash } = loaded.value;
  if (manifest.type !== "mcp" || manifest.auth.kind !== "oauth") {
    return err({
      message: `App "${slug}" does not sign in with OAuth.`,
      reason: "connect",
    });
  }

  // Supersede any in-flight sign-in for this app, and clear stale PKCE
  // material so this flow starts clean.
  dropPendingFlowsForSlug(slug);
  await store.clearTransient(slug);

  // The SDK asks for the browser while `connect` runs, before it throws for
  // the authorization it now waits on. A holder object so control-flow
  // analysis does not narrow the value to the literal it started as.
  const opened: { url?: string } = {};
  const provider = createMcpOAuthProvider({
    openAuthorization: (url) => {
      opened.url = url.toString();
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
    // A valid token from an earlier sign-in connects outright.
    await client.connect(transport);
    const tools = await client.listTools();
    await client.close().catch(noop);
    await recordConnection(slug, {
      connectedAt: now,
      manifestHash,
      status: "connected",
      toolCount: tools.tools.length,
    });
    return ok({ alreadyConnected: true });
  } catch (error) {
    await client.close().catch(noop);
    if (opened.url === undefined) {
      // Something other than the need to authorize (a network error, a
      // refresh that failed without falling through to re-auth): no browser
      // is wanted and there is no flow to park.
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
          "The sign-in produced no state parameter; the MCP server may not support authorization.",
        reason: "unauthorized",
      });
    }
    pendingFlows.set(state, {
      appsDir,
      expiresAt: now + PENDING_FLOW_TTL_MS,
      opensIn,
      provider,
      slug,
      store,
      transport,
      url: manifest.url,
    });
    return ok({ alreadyConnected: false, authorizationUrl: opened.url, state });
  }
}

/**
 * Abandon a parked flow (the user denied authorization or closed the page,
 * so the callback arrives with an error and no code). Closes the transport
 * and clears transient PKCE material. Safe to call for an unknown state.
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
}): Promise<
  Result<
    { opensIn: SignInOpensIn; slug: string; toolCount: number },
    McpConnectionError
  >
> {
  const flow = pendingFlows.get(state);
  if (!flow) {
    return err({
      message:
        "No pending sign-in matches this callback (it may have expired or been superseded).",
      reason: "unauthorized",
    });
  }
  pendingFlows.delete(state);

  // finishAuth on the original transport exchanges the code for tokens (saved
  // through the provider). That transport is already started, so the working
  // session uses a fresh transport and client that connect with the stored
  // token.
  const client = new Client({ name: APP_NAME, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(flow.url), {
    authProvider: flow.provider,
  });
  try {
    await flow.transport.finishAuth(code);
    await client.connect(transport);
    const tools = await client.listTools();
    const loaded = await loadApp(flow.appsDir, flow.slug);
    if (loaded.isErr()) {
      return err({
        message: `Signed in, but app "${flow.slug}" no longer exists.`,
        reason: "connect",
      });
    }
    // The connect and the list prove the app works, so it is connected now:
    // the user should not have to wait on a separate test after signing in.
    await recordConnection(flow.slug, {
      connectedAt: Date.now(),
      manifestHash: loaded.value.manifestHash,
      status: "connected",
      toolCount: tools.tools.length,
    });
    return ok({
      opensIn: flow.opensIn,
      slug: flow.slug,
      toolCount: tools.tools.length,
    });
  } catch (error) {
    return err({
      message: error instanceof Error ? error.message : String(error),
      reason: "unauthorized",
    });
  } finally {
    // The one-time PKCE material has served its purpose; drop it so it cannot
    // corrupt a later sign-in. Tokens and the client registration stay.
    await flow.store.clearTransient(flow.slug).catch(noop);
    await client.close().catch(noop);
    await flow.transport.close().catch(noop);
  }
}

/** The slug a parked flow belongs to, for the callback to name it. */
export function pendingMcpOAuthSlug(state: string): string | undefined {
  return pendingFlows.get(state)?.slug;
}

function dropPendingFlowsForSlug(slug: string): void {
  // A new sign-in for an app supersedes any in-flight one: close the old
  // transport and clear its entry so a stale page resolves to a clean "no
  // pending sign-in" error instead of a PKCE mismatch.
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
