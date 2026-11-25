import { TOOL_NAMES } from "../../../tools/name";
import { APP_NAME } from "@instrument-org/shared";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { err, ok, type Result } from "neverthrow";
import { noop } from "radashi";

import { APP_COMMAND } from "../../../model-text/commands/app-command";
import {
  performSignedInRequest,
  redeemApiSignIn,
  startApiSignIn,
} from "../api-oauth";
import { catalogApiSignInClient } from "../catalog";
import {
  readConnection,
  recordConnection,
  type SignInOpensIn,
} from "../connection";
import { type ApiAppManifest, type McpAppManifest } from "../manifest";
import { boundTo, credentialOrigin } from "../origin-bound";
import { loadApp } from "../store";
import { runAppTest } from "../test-app";
import {
  appUpdateEnded,
  finishAppUpdate,
  forgetEndedAppUpdate,
  type UpdatedManifest,
} from "../update-connection";
import { describeMcpFailure, type McpConnectionError } from "./client";
import { fetchForMcp } from "./fetch";
import { type RegistrationRefusal, watchRegistration } from "./registration";
import {
  createMcpOAuthProvider,
  mcpSignInClient,
  type McpOAuthStore,
} from "./oauth-provider";

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
 *
 * An API app that signs in (`type: "api"`, `auth.kind: "oauth"`) goes through
 * the same begin and complete, with the client the directory has for its
 * service (`api-oauth.ts`): what is parked is how to redeem its code, and
 * the app's own test is what connects it.
 */
type PendingFlow = PendingApiFlow | PendingMcpFlow;

interface PendingApiFlow {
  expiresAt: number;
  expiry?: ReturnType<typeof setTimeout>;
  kind: "api";
  opensIn: SignInOpensIn;
  /** For an update, the setup the app has once it lands; it stays as it is until then. */
  updatesTo?: ApiAppManifest;
  /** Redeem the code the callback brings, keeping the tokens. */
  redeem: (code: string) => Promise<void>;
  slug: string;
  store: McpOAuthStore;
}

interface PendingMcpFlow {
  expiresAt: number;
  expiry?: ReturnType<typeof setTimeout>;
  kind: "mcp";
  opensIn: SignInOpensIn;
  /** For an update, the setup the app has once it lands; it stays as it is until then. */
  updatesTo?: McpAppManifest;
  provider: ReturnType<typeof createMcpOAuthProvider>;
  slug: string;
  store: McpOAuthStore;
  // The transport that started the flow: it holds the auth state finishAuth
  // needs. The working connection uses a fresh transport, since a started
  // transport cannot be started again.
  transport: StreamableHTTPClientTransport;
  url: string;
}

// A sign-in the user never finishes (closed the tab, walked away) would
// otherwise leak a transport forever and leave the chat waiting on it. A
// parked flow lapses after this long, and the chat hears that it did.
export const PENDING_FLOW_TTL_MS = 10 * 60 * 1000;

// How long an API app's sign-in waits on the request that says whether the
// sign-in it already has still works.
const API_PROBE_TIMEOUT_MS = 30_000;

const pendingFlows = new Map<string, PendingFlow>();

/**
 * Start a sign-in. Hands back the authorization URL rather than opening it,
 * because where it opens is the caller's call: the window's own browser when
 * there is one, the system browser otherwise.
 */
export async function beginMcpOAuth({
  opensIn = "app",
  redirectUrl,
  relayRedirectUrl,
  relayTokenUrl,
  slug,
  store,
  updatesTo,
}: {
  opensIn?: SignInOpensIn;
  redirectUrl: string;
  relayRedirectUrl: (service: string) => string;
  relayTokenUrl: (service: string) => string;
  slug: string;
  store: McpOAuthStore;
  /** For an update, the setup to sign in to in place of the app's own (`update-connection.ts`). */
  updatesTo?: UpdatedManifest;
}): Promise<
  Result<
    | { alreadyConnected: false; authorizationUrl: string; state: string }
    | { alreadyConnected: true },
    McpConnectionError
  >
> {
  const now = Date.now();
  evictExpiredFlows(now);

  const loaded = await loadApp(slug);
  if (loaded.isErr()) {
    return err({ message: loaded.error.message, reason: "connect" });
  }
  const { manifestHash } = loaded.value;
  const manifest = updatesTo ?? loaded.value.manifest;
  if (
    (manifest.type !== "mcp" && manifest.type !== "api") ||
    manifest.auth.kind !== "oauth"
  ) {
    return err({
      message: `App "${slug}" does not sign in with OAuth.`,
      reason: "connect",
    });
  }

  // Supersede any in-flight sign-in for this app, and clear stale PKCE
  // material so this flow starts clean.
  dropPendingFlowsForSlug(slug);
  await store.clearTransient(slug);
  if (updatesTo) {
    // An app on the web has no tokens of its own, so any here are another
    // setup's: an update is always a new sign-in.
    await store.clearTokens(slug);
    forgetEndedAppUpdate(slug);
  }

  if (manifest.type === "api") {
    return beginApiOAuth({
      manifest,
      manifestHash,
      now,
      opensIn,
      redirectUrl,
      relayRedirectUrl,
      relayTokenUrl,
      slug,
      store,
      ...(updatesTo?.type === "api" ? { updatesTo } : {}),
    });
  }

  // The SDK asks for the browser while `connect` runs, before it throws for
  // the authorization it now waits on. A holder object so control-flow
  // analysis does not narrow the value to the literal it started as.
  const opened: { url?: string } = {};
  const origin = new URL(manifest.url).origin;
  const signIn = mcpSignInClient({
    loopbackRedirectUrl: redirectUrl,
    relayRedirectUrl,
    relayTokenUrl,
    serverUrl: manifest.url,
  });
  const scope = manifest.auth.scope ?? signIn.scope;
  const provider = createMcpOAuthProvider({
    ...signIn,
    openAuthorization: (url) => {
      opened.url = url.toString();
    },
    origin,
    scope,
    slug,
    store,
  });
  const registration = watchRegistration(fetchForMcp);
  const transport = new StreamableHTTPClientTransport(new URL(manifest.url), {
    authProvider: provider,
    fetch: registration.fetch,
  });
  const client = new Client({ name: APP_NAME, version: "1.0.0" });

  // A token from an earlier sign-in is the only thing that makes a connection
  // a sign-in. Some servers answer initialize and tools/list to a stranger and
  // refuse the first call (Google's Workspace servers do), so a connection
  // with no token behind it is discovery, not a session, and the app is not
  // connected on the strength of it. A token counts only for the server it
  // was obtained from: one saved for another origin is a sign-in the user
  // gave somewhere else, so this server gets a sign-in of its own.
  const signedIn = boundTo(await store.getTokens(slug), origin) !== undefined;

  let failure: unknown;
  try {
    await client.connect(transport);
    if (signedIn) {
      // A valid token from an earlier sign-in connects outright.
      const tools = await client.listTools();
      await client.close().catch(noop);
      await recordConnection(slug, {
        connectedAt: now,
        manifestHash,
        status: "connected",
        toolCount: tools.tools.length,
      });
      return ok({ alreadyConnected: true });
    }
    // The server let the client in without asking, so the 401 that would
    // have started the authorization is never coming: ask for it outright.
    await client.close().catch(noop);
    await auth(provider, {
      fetchFn: registration.fetch,
      scope,
      serverUrl: new URL(manifest.url),
    });
  } catch (error) {
    await client.close().catch(noop);
    failure = error;
  }
  if (opened.url === undefined) {
    // Something other than the need to authorize (a network error, a
    // refresh that failed without falling through to re-auth, a server whose
    // authorization cannot be started): no browser is wanted and there is no
    // flow to park.
    await transport.close().catch(noop);
    const refusal = registration.refusal();
    return err({
      cause: failure,
      message: `Could not start sign-in for "${slug}": ${describeSignInFailure(failure, refusal)}`,
      reason: refusal === undefined ? "connect" : "client-refused",
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
  park(state, {
    expiresAt: now + PENDING_FLOW_TTL_MS,
    kind: "mcp",
    opensIn,
    provider,
    slug,
    store,
    transport,
    ...(updatesTo?.type === "mcp" ? { updatesTo } : {}),
    url: manifest.url,
  });
  return ok({ alreadyConnected: false, authorizationUrl: opened.url, state });
}

/**
 * Start an API app's sign-in. A sign-in it already has that the API still
 * takes connects it outright; otherwise the authorization page is handed
 * back and the redemption parked for the callback.
 */
async function beginApiOAuth({
  manifest,
  manifestHash,
  now,
  opensIn,
  redirectUrl,
  relayRedirectUrl,
  relayTokenUrl,
  slug,
  store,
  updatesTo,
}: {
  manifest: ApiAppManifest;
  manifestHash: string;
  now: number;
  opensIn: SignInOpensIn;
  redirectUrl: string;
  relayRedirectUrl: (service: string) => string;
  relayTokenUrl: (service: string) => string;
  slug: string;
  store: McpOAuthStore;
  updatesTo?: ApiAppManifest;
}): Promise<
  Result<
    | { alreadyConnected: false; authorizationUrl: string; state: string }
    | { alreadyConnected: true },
    McpConnectionError
  >
> {
  const client = catalogApiSignInClient(slug, manifest);
  if (client === undefined) {
    return err({
      message: `${APP_NAME} has no sign-in client for ${manifest.url} in this directory, so "${slug}" cannot sign in. Set it up the way \`${APP_COMMAND.name} catalog\` says for the service.`,
      reason: "connect",
    });
  }
  const origin = credentialOrigin(manifest);
  if (boundTo(await store.getTokens(slug), origin) !== undefined) {
    const probe = await performSignedInRequest({
      body: manifest.test.body,
      manifest,
      method: manifest.test.method ?? "GET",
      params: {},
      path: manifest.test.path,
      signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
      slug,
    }).catch(noop);
    const status = probe?.result.isOk() ? probe.result.value.status : 0;
    if (status >= 200 && status < 300) {
      await recordConnection(slug, {
        connectedAt: now,
        manifestHash,
        status: "connected",
      });
      return ok({ alreadyConnected: true });
    }
  }
  let started: Awaited<ReturnType<typeof startApiSignIn>>;
  try {
    started = await startApiSignIn({
      client,
      loopbackRedirectUrl: redirectUrl,
      relayRedirectUrl,
      relayTokenUrl,
      slug,
      store,
    });
  } catch (error) {
    return err({
      cause: error,
      message: `Could not start sign-in for "${slug}": ${describeSignInFailure(error)}`,
      reason: "connect",
    });
  }
  park(started.state, {
    expiresAt: now + PENDING_FLOW_TTL_MS,
    kind: "api",
    opensIn,
    redeem: (code) =>
      redeemApiSignIn({
        client,
        code,
        origin,
        redirectUrl: started.redirectUrl,
        relayTokenUrl,
        slug,
        store,
      }),
    slug,
    store,
    ...(updatesTo ? { updatesTo } : {}),
  });
  return ok({
    alreadyConnected: false,
    authorizationUrl: started.authorizationUrl,
    state: started.state,
  });
}

/**
 * Abandon a parked flow (the user denied authorization or closed the page,
 * so the callback arrives with an error and no code). Closes the transport
 * and clears transient PKCE material. Safe to call for an unknown state.
 */
export async function cancelMcpOAuth(state: string): Promise<void> {
  const flow = forget(state);
  if (!flow) {
    return;
  }
  await closeFlow(flow);
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
    { opensIn: SignInOpensIn; slug: string; toolCount?: number },
    McpConnectionError
  >
> {
  const flow = forget(state);
  if (!flow) {
    return err({
      message:
        "No pending sign-in matches this callback (it may have expired or been superseded).",
      reason: "unauthorized",
    });
  }
  const result =
    flow.kind === "api"
      ? await completeApiOAuth(flow, code)
      : await completeHostedMcpOAuth(flow, code);
  if (flow.updatesTo && result.isErr()) {
    // The app goes on working on the web, so a sign-in that did not land is
    // not left behind as one it has.
    const loaded = await loadApp(flow.slug);
    if (loaded.isErr() || loaded.value.manifest.type === "web") {
      await flow.store.clearTokens(flow.slug).catch(noop);
    }
  }
  return result;
}

async function completeHostedMcpOAuth(
  flow: PendingMcpFlow,
  code: string,
): Promise<
  Result<
    { opensIn: SignInOpensIn; slug: string; toolCount?: number },
    McpConnectionError
  >
> {
  // finishAuth on the original transport exchanges the code for tokens (saved
  // through the provider). That transport is already started, so the working
  // session uses a fresh transport and client that connect with the stored
  // token.
  const client = new Client({ name: APP_NAME, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(flow.url), {
    authProvider: flow.provider,
    fetch: fetchForMcp,
  });
  try {
    await flow.transport.finishAuth(code);
    await client.connect(transport);
    const tools = await client.listTools();
    if (flow.updatesTo) {
      return await finishUpdate(flow, flow.updatesTo, tools.tools.length);
    }
    const loaded = await loadApp(flow.slug);
    if (loaded.isErr()) {
      return err({
        message: `Signed in, but app "${flow.slug}" no longer exists.`,
        reason: "connect",
      });
    }
    // The tokens belong to the server the sign-in began against. A manifest
    // pointed elsewhere since is not what the user signed in to.
    const current = loaded.value.manifest;
    if (
      current.type !== "mcp" ||
      new URL(current.url).origin !== new URL(flow.url).origin
    ) {
      return err({
        message: `Signed in, but app "${flow.slug}" now points at another server. Ask the user to sign in again with ${TOOL_NAMES.connectApp}.`,
        reason: "unauthorized",
      });
    }
    // The connect and the list prove the app works, so it is connected now:
    // the user should not have to wait on a separate test after signing in.
    await recordConnection(flow.slug, {
      connectedAt: Date.now(),
      manifestHash: loaded.value.manifestHash,
      signedInFrom: flow.opensIn,
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
      cause: error,
      message: describeMcpFailure(error),
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

/** Whether a parked flow is an app's update, whose end leaves its connection alone. */
export function isPendingAppUpdate(state: string): boolean {
  return pendingFlows.get(state)?.updatesTo !== undefined;
}

/** Where the sign-in of an app's update was opened, while it waits. */
export function pendingAppUpdate(slug: string): SignInOpensIn | undefined {
  for (const flow of pendingFlows.values()) {
    if (flow.slug === slug && flow.updatesTo) {
      return flow.opensIn;
    }
  }
  return undefined;
}

/** The slug a parked flow belongs to, for the callback to name it. */
export function pendingMcpOAuthSlug(state: string): string | undefined {
  return pendingFlows.get(state)?.slug;
}

/**
 * Why a sign-in could not begin, in words the conversation can pass on. A
 * server that refuses the client registration will not take Instrument as a
 * client (many take only ones they approved in advance, as Figma's and
 * Monarch's do), so asking again changes nothing. What the server said
 * follows either way, for the agent to read.
 */
export function describeSignInFailure(
  failure: unknown,
  refusal?: RegistrationRefusal,
): string {
  if (refusal !== undefined) {
    const code = refusal.error === undefined ? "" : `, ${refusal.error}`;
    return `the server refuses to register ${APP_NAME} as a client (HTTP ${refusal.status}${code}), as servers that take only clients they approved in advance do, so this sign-in cannot start${refusal.said === undefined ? "" : `. The server said: ${refusal.said}`}`;
  }
  if (failure === undefined) {
    return "the server asked for no authorization";
  }
  // Anything that is neither an Error nor a string has no words of its own to
  // pass on, and stringifying it would put "[object Object]" in front of the
  // user.
  if (!(failure instanceof Error) && typeof failure !== "string") {
    return "the server refused the sign-in without saying why";
  }
  return describeMcpFailure(failure);
}

/**
 * Redeem an API app's code, then run the app's test, which reaches the API
 * with the new token and is what connects the app.
 */
async function completeApiOAuth(
  flow: PendingApiFlow,
  code: string,
): Promise<
  Result<{ opensIn: SignInOpensIn; slug: string }, McpConnectionError>
> {
  try {
    await flow.redeem(code);
  } catch (error) {
    return err({
      cause: error,
      message: describeMcpFailure(error),
      reason: "unauthorized",
    });
  } finally {
    await flow.store.clearTransient(flow.slug).catch(noop);
  }
  if (flow.updatesTo) {
    return finishApiUpdate(flow, flow.updatesTo);
  }
  // Before the test, whose passing is what readers of the connection wait for.
  const connection = await readConnection(flow.slug);
  await recordConnection(flow.slug, {
    signedInFrom: flow.opensIn,
    status: connection?.status === "connected" ? "connected" : "needs-sign-in",
  });
  const report = await runAppTest({
    signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
    slug: flow.slug,
  });
  if (!report.passed) {
    const failed = report.checks.find((check) => check.status === "fail");
    return err({
      message: `Signed in, but the app's test failed: ${failed?.detail ?? "no check passed"}`,
      reason: "connect",
    });
  }
  return ok({ opensIn: flow.opensIn, slug: flow.slug });
}

/**
 * An API app's update, once its code is redeemed: the directory's own check is
 * sent with the new token before anything is written.
 */
async function finishApiUpdate(
  flow: PendingApiFlow,
  manifest: ApiAppManifest,
): Promise<
  Result<{ opensIn: SignInOpensIn; slug: string }, McpConnectionError>
> {
  try {
    const { result } = await performSignedInRequest({
      body: manifest.test.body,
      manifest,
      method: manifest.test.method ?? "GET",
      params: {},
      path: manifest.test.path,
      signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
      slug: flow.slug,
    });
    const status = result.isOk() ? result.value.status : undefined;
    if (status === undefined || status < 200 || status >= 300) {
      return err({
        message: `Signed in, but ${manifest.test.path} ${status === undefined ? "could not be reached" : `answered HTTP ${status}`}.`,
        reason: "connect",
      });
    }
  } catch (error) {
    return err({
      cause: error,
      message: describeMcpFailure(error),
      reason: "connect",
    });
  }
  return finishUpdate(flow, manifest);
}

async function finishUpdate(
  flow: PendingFlow,
  manifest: UpdatedManifest,
  toolCount?: number,
): Promise<
  Result<
    { opensIn: SignInOpensIn; slug: string; toolCount?: number },
    McpConnectionError
  >
> {
  const counted = toolCount === undefined ? {} : { toolCount };
  const landed = await finishAppUpdate({
    manifest,
    opensIn: flow.opensIn,
    slug: flow.slug,
    ...counted,
  });
  return landed
    ? ok({ opensIn: flow.opensIn, slug: flow.slug, ...counted })
    : err({
        message: `Signed in, but "${flow.slug}" changed while the sign-in was open, so it was left as it is.`,
        reason: "connect",
      });
}

/** Let go of what a parked flow holds open. */
async function closeFlow(flow: PendingFlow): Promise<void> {
  if (flow.kind === "mcp") {
    await flow.transport.close().catch(noop);
  }
}

function dropPendingFlowsForSlug(slug: string): void {
  // A new sign-in for an app supersedes any in-flight one: close the old
  // transport and clear its entry so a stale page resolves to a clean "no
  // pending sign-in" error instead of a PKCE mismatch.
  for (const [state, flow] of pendingFlows) {
    if (flow.slug === slug) {
      forget(state);
      void closeFlow(flow);
    }
  }
}

function evictExpiredFlows(now: number): void {
  for (const [state, flow] of pendingFlows) {
    if (flow.expiresAt <= now) {
      forget(state);
      void closeFlow(flow);
    }
  }
}

/** Keep a flow for its callback, until it lapses. */
function park(state: string, flow: PendingFlow): void {
  const expiry = setTimeout(() => {
    void lapse(state);
  }, flow.expiresAt - Date.now());
  // A sign-in left open never holds the process up.
  expiry.unref?.();
  pendingFlows.set(state, { ...flow, expiry });
}

/** Take a parked flow out of waiting, so its lapse never fires. */
function forget(state: string): PendingFlow | undefined {
  const flow = pendingFlows.get(state);
  if (flow) {
    clearTimeout(flow.expiry);
    pendingFlows.delete(state);
  }
  return flow;
}

/**
 * A sign-in nobody finished in time: the flow lets go of what it held, and
 * the app records the sign-in as lapsed, which wakes the chats waiting on it
 * with the way on (signing in on the web, or trying again).
 */
async function lapse(state: string): Promise<void> {
  const flow = forget(state);
  if (!flow) {
    return;
  }
  await closeFlow(flow);
  await flow.store.clearTransient(flow.slug).catch(noop);
  if (flow.updatesTo) {
    await appUpdateEnded(flow.slug, "expired");
    return;
  }
  const connection = await readConnection(flow.slug);
  if (connection?.status === "connected") {
    return;
  }
  // Nothing went wrong and nobody is told: the app is back to needing its
  // sign-in, with a line on its row saying the last one timed out.
  await recordConnection(flow.slug, {
    ended: "expired",
    error:
      "The sign-in page was left open without finishing, and the sign-in lapsed.",
    status: "needs-sign-in",
  });
}
