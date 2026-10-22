import {
  exchangeAuthorization,
  refreshAuthorization,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { type OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { type Result } from "neverthrow";

import { getWorkspaceConfig } from "../workspace-config";
import { type ApiSignInClient, catalogApiSignInClient } from "./catalog";
import { type ApiAppManifest } from "./manifest";
import { describeMcpFailure } from "./mcp/client";
import { fetchForMcp } from "./mcp/fetch";
import { type McpOAuthStore } from "./mcp/oauth-provider";
import { boundTo, credentialOrigin } from "./origin-bound";
import {
  type AppRequestError,
  type AppResponse,
  performAppRequest,
} from "./request";
import { webInsteadUrl } from "./site";
import { webInsteadCommand } from "./web-instead";

/**
 * Sign-in for an API app (`type: "api"`, `auth: { kind: "oauth" }`), with the
 * client the directory has for the app's service. A plain API publishes no
 * sign-in metadata, so the directory names the vendor's authorization page,
 * and the code is redeemed and the token refreshed at our API's token route,
 * which holds the client's secret. Tokens go in the same store as an MCP
 * app's, bound to the API's origin, and a request sends the access token as
 * a bearer token, refreshing it once when the API answers 401.
 */

/**
 * Thrown when only a new sign-in by the user gets the app a token again, with
 * the web named for when that sign-in will not take.
 */
export class SignInNeededError extends Error {
  constructor(
    { manifest, slug }: { manifest: ApiAppManifest; slug: string },
    options?: ErrorOptions,
  ) {
    super(
      `This app needs the user to sign in again. Ask with connect_app; if that sign-in fails or is refused, sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`,
      options,
    );
  }
}

/**
 * Thrown when a refresh fails for a reason a new sign-in does not fix, such
 * as the token route being down: another try later, then the web.
 */
class RefreshFailedError extends Error {
  constructor(
    { manifest, slug }: { manifest: ApiAppManifest; slug: string },
    options: ErrorOptions & { cause: unknown },
  ) {
    super(
      `Refreshing ${slug}'s sign-in failed: ${describeMcpFailure(options.cause)}. Signing in again does not change this. Try again in a minute; if it keeps failing, sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`,
      options,
    );
  }
}

/**
 * The vendor's sign-in as the SDK's helpers take it: the directory's
 * authorization page and our API's token route, PKCE with S256.
 */
function signInMetadata(
  client: ApiSignInClient,
  relayTokenUrl: (service: string) => string,
): OAuthMetadata {
  return {
    authorization_endpoint: client.authorizationEndpoint,
    code_challenge_methods_supported: ["S256"],
    issuer: new URL(client.authorizationEndpoint).origin,
    response_types_supported: ["code"],
    token_endpoint: relayTokenUrl(client.service),
  };
}

/**
 * The authorization page for a sign-in, with its PKCE verifier and state
 * saved for the callback. The vendor sends the browser back through our
 * API's relay, which reads the loopback port from the front of the state.
 */
export async function startApiSignIn({
  client,
  loopbackRedirectUrl,
  relayRedirectUrl,
  relayTokenUrl,
  slug,
  store,
}: {
  client: ApiSignInClient;
  loopbackRedirectUrl: string;
  relayRedirectUrl: (service: string) => string;
  relayTokenUrl: (service: string) => string;
  slug: string;
  store: McpOAuthStore;
}): Promise<{ authorizationUrl: string; redirectUrl: string; state: string }> {
  const redirectUrl = relayRedirectUrl(client.service);
  const state = `${new URL(loopbackRedirectUrl).port}.${crypto.randomUUID()}`;
  await store.saveState(slug, state);
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    client.authorizationEndpoint,
    {
      clientInformation: { client_id: client.clientId },
      metadata: signInMetadata(client, relayTokenUrl),
      redirectUrl,
      scope: client.scope,
      state,
    },
  );
  await store.saveCodeVerifier(slug, codeVerifier);
  for (const [name, value] of Object.entries(
    client.authorizationParams ?? {},
  )) {
    authorizationUrl.searchParams.set(name, value);
  }
  return { authorizationUrl: authorizationUrl.toString(), redirectUrl, state };
}

/** Redeem the code a sign-in came back with, and keep the tokens for `origin`. */
export async function redeemApiSignIn({
  client,
  code,
  origin,
  redirectUrl,
  relayTokenUrl,
  slug,
  store,
}: {
  client: ApiSignInClient;
  code: string;
  origin: string;
  redirectUrl: string;
  relayTokenUrl: (service: string) => string;
  slug: string;
  store: McpOAuthStore;
}): Promise<void> {
  const codeVerifier = await store.getCodeVerifier(slug);
  if (codeVerifier === undefined) {
    throw new Error(
      `No PKCE code verifier stored for app "${slug}"; start the sign-in again.`,
    );
  }
  const tokens = await exchangeAuthorization(client.authorizationEndpoint, {
    authorizationCode: code,
    clientInformation: { client_id: client.clientId },
    codeVerifier,
    fetchFn: fetchForMcp,
    metadata: signInMetadata(client, relayTokenUrl),
    redirectUri: redirectUrl,
  });
  await store.saveTokens(slug, { origin, value: tokens });
}

// One refresh per app at a time: the vendor rotates refresh tokens, so two
// requests refreshing at once would each spend the same one.
const refreshing = new Map<string, Promise<string>>();

/**
 * The access token an API app's request sends, or with `fresh`, a new one
 * from its refresh token. Throws `SignInNeededError` when there is no
 * sign-in for the API's origin, the directory no longer has the app's
 * client, or the vendor refuses the refresh token.
 */
async function apiAccessToken(
  slug: string,
  manifest: ApiAppManifest,
  { fresh }: { fresh: boolean },
): Promise<string> {
  const oauth = getWorkspaceConfig().apps.oauth;
  if (!oauth) {
    throw new Error("Sign-in is not available in this context.");
  }
  const origin = credentialOrigin(manifest);
  const tokens = boundTo(await oauth.store.getTokens(slug), origin);
  if (tokens === undefined) {
    throw new SignInNeededError({ manifest, slug });
  }
  if (!fresh) {
    return tokens.access_token;
  }
  const client = catalogApiSignInClient(slug, manifest);
  const refreshToken = tokens.refresh_token;
  if (client === undefined) {
    // With no client a new sign-in cannot start either, so the web is all
    // that is left.
    throw new Error(
      `The directory no longer has a sign-in client for ${manifest.url}, so "${slug}" can neither refresh its sign-in nor start a new one. Sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`,
    );
  }
  if (refreshToken === undefined) {
    throw new SignInNeededError({ manifest, slug });
  }
  const running = refreshing.get(slug);
  if (running) {
    return running;
  }
  const refresh = (async () => {
    try {
      const next = await refreshAuthorization(client.authorizationEndpoint, {
        clientInformation: { client_id: client.clientId },
        fetchFn: fetchForMcp,
        metadata: signInMetadata(client, oauth.relayTokenUrl),
        refreshToken,
      });
      await oauth.store.saveTokens(slug, { origin, value: next });
      return next.access_token;
    } catch (error) {
      // A refresh token the vendor no longer honors (revoked, expired, the
      // password changed) is gone for good; anything else, such as our API
      // being unreachable, leaves the sign-in for the next try.
      if (error instanceof InvalidGrantError) {
        await oauth.store.clearTokens(slug);
        throw new SignInNeededError({ manifest, slug }, { cause: error });
      }
      throw new RefreshFailedError({ manifest, slug }, { cause: error });
    }
  })().finally(() => {
    refreshing.delete(slug);
  });
  refreshing.set(slug, refresh);
  return refresh;
}

/**
 * One request to a signed-in API app, sent with its access token and sent
 * once more with a refreshed one when the API answers 401, since an access
 * token lasts about an hour. Hands back the token it last sent, for the
 * caller to keep out of what the agent reads.
 */
export async function performSignedInRequest({
  slug,
  ...request
}: Omit<Parameters<typeof performAppRequest>[0], "credential"> & {
  slug: string;
}): Promise<{
  result: Result<AppResponse, AppRequestError>;
  token: string;
}> {
  let token = await apiAccessToken(slug, request.manifest, { fresh: false });
  let result = await performAppRequest({ ...request, credential: token });
  if (result.isOk() && result.value.status === 401) {
    token = await apiAccessToken(slug, request.manifest, { fresh: true });
    result = await performAppRequest({ ...request, credential: token });
  }
  return { result, token };
}
