import { APP_NAME } from "@instrument-org/shared";
import { type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type OAuthClientInformation,
  type OAuthClientInformationFull,
  type OAuthClientMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { boundTo, type OriginBound } from "../origin-bound";

/**
 * Everything the OAuth flow must persist for one app, keyed by slug. The
 * host app backs this with its encrypted store (tokens, client secret) so
 * secrets never touch the app folder or the model. All methods are async
 * to allow a keychain/IPC-backed implementation.
 *
 * - client info: the result of dynamic client registration (RFC 7591).
 * - tokens: access/refresh tokens; the SDK reads them on connect and refreshes.
 *
 * Client info and tokens are kept with the origin of the MCP server they were
 * obtained for, and handed back only to a provider for that same origin.
 * - codeVerifier/state: transient PKCE material for one in-flight authorization.
 */
export interface McpOAuthStore {
  clearClientInformation(slug: string): Promise<void>;
  clearTokens(slug: string): Promise<void>;
  // Clears the transient PKCE material (codeVerifier + state) for one flow,
  // leaving durable tokens/client info. Called after a flow finishes or is
  // abandoned so a stale verifier/state never corrupts a later sign-in.
  clearTransient(slug: string): Promise<void>;
  getClientInformation(
    slug: string,
  ): Promise<OriginBound<OAuthClientInformationFull> | undefined>;
  getCodeVerifier(slug: string): Promise<string | undefined>;
  getState(slug: string): Promise<string | undefined>;
  getTokens(slug: string): Promise<OriginBound<OAuthTokens> | undefined>;
  saveClientInformation(
    slug: string,
    info: OriginBound<OAuthClientInformationFull>,
  ): Promise<void>;
  saveCodeVerifier(slug: string, verifier: string): Promise<void>;
  saveState(slug: string, state: string): Promise<void>;
  saveTokens(slug: string, tokens: OriginBound<OAuthTokens>): Promise<void>;
}

/**
 * Build an OAuthClientProvider (the SDK contract) for one MCP app. The
 * SDK drives discovery, dynamic client registration, the PKCE authorization
 * URL, and token exchange/refresh; this provider supplies storage, the
 * loopback redirect URL, and the browser-open action.
 *
 * `openAuthorization` is injected by the host (Electron opens the system
 * browser); in a non-interactive context it can throw or no-op.
 *
 * `origin` is the MCP server's origin under the manifest as it stands. What
 * this provider saves is recorded against it, and what it reads back is only
 * what was saved for it: a manifest pointed at another server gets no token
 * and no client registration, so the SDK asks for a fresh sign-in there
 * instead of handing that server the user's session.
 */
export function createMcpOAuthProvider({
  openAuthorization,
  origin,
  redirectUrl,
  scope,
  slug,
  store,
}: {
  openAuthorization: (url: URL) => Promise<void> | void;
  origin: string;
  redirectUrl: string;
  scope?: string;
  slug: string;
  store: McpOAuthStore;
}): OAuthClientProvider {
  const clientMetadata: OAuthClientMetadata = {
    client_name: APP_NAME,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [redirectUrl],
    response_types: ["code"],
    scope,
    token_endpoint_auth_method: "none",
  };

  return {
    clientInformation: async () =>
      boundTo(await store.getClientInformation(slug), origin),
    clientMetadata,
    codeVerifier: async () => {
      const verifier = await store.getCodeVerifier(slug);
      if (verifier === undefined) {
        throw new Error(
          `No PKCE code verifier stored for app "${slug}"; start the OAuth flow again.`,
        );
      }
      return verifier;
    },
    // The SDK calls this when a grant fails (e.g. a refresh token was revoked),
    // then retries -- so clearing the bad tokens lets the retry fall through to
    // a fresh browser authorization instead of looping on the dead token.
    invalidateCredentials: async (invalidateScope) => {
      if (invalidateScope === "all" || invalidateScope === "client") {
        await store.clearClientInformation(slug);
      }
      if (invalidateScope === "all" || invalidateScope === "tokens") {
        await store.clearTokens(slug);
      }
      if (invalidateScope === "all" || invalidateScope === "verifier") {
        await store.clearTransient(slug);
      }
    },
    redirectToAuthorization: (authorizationUrl) =>
      openAuthorization(authorizationUrl),
    redirectUrl,
    saveClientInformation: (info: OAuthClientInformation) =>
      // DCR always returns the full shape; persist it for later reads.
      store.saveClientInformation(slug, {
        origin,
        value: info as OAuthClientInformationFull,
      }),
    saveCodeVerifier: (verifier) => store.saveCodeVerifier(slug, verifier),
    saveTokens: (tokens) => store.saveTokens(slug, { origin, value: tokens }),
    // Always mint a fresh state per authorization -- never reuse a stored one,
    // so state stays single-use (its CSRF purpose) and a stale value can't make
    // a later begin misfire.
    state: async () => {
      const state = crypto.randomUUID();
      await store.saveState(slug, state);
      return state;
    },
    tokens: async () => boundTo(await store.getTokens(slug), origin),
  };
}
