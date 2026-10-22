import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";

import { getWorkspaceConfig } from "../../workspace-config";
import { type McpAppManifest } from "../manifest";
import { credentialOrigin } from "../origin-bound";
import { webInsteadUrl } from "../site";
import { webInsteadCommand } from "../web-instead";
import {
  createMcpOAuthProvider,
  mcpSignInClient,
  type McpOAuthStore,
} from "./oauth-provider";

/**
 * What a command meets when an MCP app's sign-in is gone and only the user can
 * give it again: its message says how, and where to go when that sign-in will
 * not take.
 */
export class SignInAgainError extends UnauthorizedError {}

/**
 * The OAuth provider an `app` command uses to reach an OAuth MCP app. It reads
 * (and lets the SDK refresh) tokens the interactive sign-in obtained; it
 * cannot start a sign-in, since a command cannot open a browser and wait, so
 * `redirectToAuthorization` throws, which surfaces as an unauthorized error
 * that tells the agent to ask the user to sign in again.
 *
 * It never finishes an authorization either, so the PKCE state and verifier
 * the SDK writes on the way to that throw stay with this provider rather than
 * in the store's slot for the app, where a sign-in the user has open keeps
 * the verifier its callback needs.
 *
 * Undefined for non-OAuth apps and when no OAuth store is configured
 * (headless and test contexts); callers treat the latter as "sign-in is not
 * available here".
 */
export function mcpAuthProviderForCommand(
  slug: string,
  manifest: McpAppManifest,
): OAuthClientProvider | undefined {
  if (manifest.auth.kind !== "oauth") {
    return undefined;
  }
  const oauth = getWorkspaceConfig().apps.oauth;
  if (!oauth) {
    return undefined;
  }
  const signIn = mcpSignInClient({
    loopbackRedirectUrl: oauth.redirectUrl(),
    relayRedirectUrl: oauth.relayRedirectUrl,
    relayTokenUrl: oauth.relayTokenUrl,
    serverUrl: manifest.url,
  });
  return createMcpOAuthProvider({
    ...signIn,
    openAuthorization: () => {
      throw new SignInAgainError(
        `This app needs the user to sign in again. Ask with connect_app; if that sign-in fails or is refused, sign in on the web instead: \`${webInsteadCommand(slug, webInsteadUrl(slug, manifest))}\`, then connect_app.`,
      );
    },
    origin: credentialOrigin(manifest),
    scope: manifest.auth.scope ?? signIn.scope,
    slug,
    store: withOwnTransient(oauth.store),
  });
}

/** The store, with PKCE material kept in memory for one provider alone. */
function withOwnTransient(store: McpOAuthStore): McpOAuthStore {
  const own: { state?: string; verifier?: string } = {};
  return {
    ...store,
    clearTransient: () => {
      delete own.state;
      delete own.verifier;
      return Promise.resolve();
    },
    getCodeVerifier: () => Promise.resolve(own.verifier),
    getState: () => Promise.resolve(own.state),
    saveCodeVerifier: (_slug, verifier) => {
      own.verifier = verifier;
      return Promise.resolve();
    },
    saveState: (_slug, state) => {
      own.state = state;
      return Promise.resolve();
    },
  };
}
