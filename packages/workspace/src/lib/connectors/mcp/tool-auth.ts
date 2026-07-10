import { type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

import { getWorkspaceConfig } from "../../workspace-config";
import { type McpConnectorManifest } from "../manifest";
import { createMcpOAuthProvider } from "./oauth-provider";

/**
 * The OAuth provider to use when an agent tool connects to an OAuth MCP
 * connector. It reads (and lets the SDK refresh) tokens already obtained by the
 * interactive sign-in; it cannot start a new sign-in, since a tool call can't
 * open a browser and wait -- so `redirectToAuthorization` throws, surfacing as
 * an unauthorized error that tells the user to connect from Settings.
 *
 * Returns undefined for non-OAuth connectors and when no OAuth store is
 * configured (headless/test contexts); callers treat the latter as "OAuth not
 * available here".
 */
export function mcpAuthProviderForTool(
  slug: string,
  manifest: McpConnectorManifest,
): OAuthClientProvider | undefined {
  if (manifest.auth.kind !== "oauth") {
    return undefined;
  }
  const oauth = getWorkspaceConfig().connectors.oauth;
  if (!oauth) {
    return undefined;
  }
  return createMcpOAuthProvider({
    openAuthorization: () => {
      throw new Error(
        "This connector needs an interactive sign-in. Ask the user to connect it from Settings -> Connectors.",
      );
    },
    redirectUrl: oauth.redirectUrl,
    scope: manifest.auth.scope,
    slug,
    store: oauth.store,
  });
}
