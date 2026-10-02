import { type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

import { getWorkspaceConfig } from "../../workspace-config";
import { type McpAppManifest } from "../manifest";
import { createMcpOAuthProvider } from "./oauth-provider";

/**
 * The OAuth provider an `app` command uses to reach an OAuth MCP app. It reads
 * (and lets the SDK refresh) tokens the interactive sign-in obtained; it
 * cannot start a sign-in, since a command cannot open a browser and wait, so
 * `redirectToAuthorization` throws, which surfaces as an unauthorized error
 * that tells the agent to ask the user to sign in again.
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
  return createMcpOAuthProvider({
    openAuthorization: () => {
      throw new Error(
        "This app needs the user to sign in again. Ask with connect_app.",
      );
    },
    redirectUrl: oauth.redirectUrl(),
    scope: manifest.auth.scope,
    slug,
    store: oauth.store,
  });
}
