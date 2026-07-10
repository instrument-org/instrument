import { type McpConnectorManifest } from "../manifest";
import { type McpConnectionConfig } from "./client";

/**
 * Build the connection config for an MCP connector by folding its stored
 * credential into the manifest's auth binding. A missing credential for a
 * non-`none` auth mode degrades to `none`, so the connect attempt fails with a
 * clear unauthorized error rather than silently sending an empty token.
 */
export function mcpConnectionConfig(
  manifest: McpConnectorManifest,
  credential: null | string,
): McpConnectionConfig {
  // OAuth connectors authenticate via the injected authProvider, not a stored
  // header credential, so the header config is "none" here.
  if (manifest.auth.kind === "none" || manifest.auth.kind === "oauth") {
    return { auth: { kind: "none" }, url: manifest.url };
  }
  if (credential === null) {
    return { auth: { kind: "none" }, url: manifest.url };
  }
  if (manifest.auth.kind === "bearer") {
    return { auth: { kind: "bearer", value: credential }, url: manifest.url };
  }
  return {
    auth: { header: manifest.auth.header, kind: "header", value: credential },
    url: manifest.url,
  };
}
