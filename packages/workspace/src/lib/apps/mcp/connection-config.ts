import { commandLineToolsEnv } from "../../command-line-tools-env";
import { type PlacedKey } from "../keys";
import { type McpAppManifest } from "../manifest";
import { type McpConnectionConfig } from "./client";
import { type LocalServerLaunch } from "./local-server";

/**
 * Fold an app's stored keys into a local server's launch. A key
 * reaches the process as the environment variable the manifest
 * names for it and never as an argument, where another process on this machine
 * could read it off the command line.
 */
export function localLaunchConfig(
  launch: LocalServerLaunch,
  keys: PlacedKey[],
): LocalServerLaunch {
  return {
    ...launch,
    env: {
      ...launch.env,
      ...Object.fromEntries(
        keys.flatMap(({ placement, value }) =>
          placement.kind === "env" ? [[placement.envVar, value]] : [],
        ),
      ),
      // A local server runs outside the native sandbox, so on a Mac without
      // the developer tools this guard is what keeps a stub it reaches from
      // opening their installer, and no manifest replaces it.
      ...commandLineToolsEnv(),
    },
  };
}

/**
 * Build the connection config for an MCP app: its stored keys as the headers
 * the manifest places them in. With none (an open server, a signed-in app,
 * whose injected authProvider authenticates it) it sends no header of its own.
 */
export function mcpConnectionConfig(
  manifest: McpAppManifest,
  keys: PlacedKey[],
): McpConnectionConfig {
  return {
    headers: Object.fromEntries(
      keys.flatMap(({ placement, value }) =>
        placement.kind === "bearer"
          ? [["Authorization", `Bearer ${value}`]]
          : placement.kind === "header"
            ? [[placement.header, value]]
            : [],
      ),
    ),
    url: manifest.url,
  };
}
