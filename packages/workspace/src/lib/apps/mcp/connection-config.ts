import { type LocalMcpAppManifest, type McpAppManifest } from "../manifest";
import { type McpConnectionConfig } from "./client";
import { type LocalServerLaunch } from "./local-server";

/**
 * Fold an app's own environment and its stored credential into a local
 * server's launch. The credential reaches the process as the environment
 * variable the manifest names and never as an argument, where another process
 * on this machine could read it off the command line.
 */
export function localLaunchConfig(
  launch: LocalServerLaunch,
  manifest: LocalMcpAppManifest,
  credential: null | string,
): LocalServerLaunch {
  return {
    ...launch,
    env: {
      ...launch.env,
      ...manifest.env,
      ...(manifest.auth.kind === "env" && credential !== null
        ? { [manifest.auth.envVar]: credential }
        : {}),
    },
  };
}

/**
 * Build the connection config for an MCP app by folding its stored
 * credential into the manifest's auth binding. A missing credential for a
 * non-`none` auth mode degrades to `none`, so the connect attempt fails with a
 * clear unauthorized error rather than silently sending an empty token.
 */
export function mcpConnectionConfig(
  manifest: McpAppManifest,
  credential: null | string,
): McpConnectionConfig {
  // OAuth apps authenticate via the injected authProvider, not a stored
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
