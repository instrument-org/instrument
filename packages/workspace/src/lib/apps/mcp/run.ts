import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { err, type Result } from "neverthrow";

import { readConnection } from "../connection";
import { type LocalMcpAppManifest, type McpAppManifest } from "../manifest";
import {
  type McpConnectionError,
  withLocalMcpClient,
  withMcpClient,
} from "./client";
import { localLaunchConfig, mcpConnectionConfig } from "./connection-config";
import { prepareLocalServer } from "./local-server";
import { mcpAuthProviderForCommand } from "./tool-auth";

/**
 * Reach an app's MCP server, wherever it runs, and run one operation against
 * it. A hosted server is a request; a local one is a process this starts and
 * ends, which the user has to have allowed first.
 *
 * That approval is pinned to the manifest that was approved, the same way a
 * connection is: a package or arguments edited afterwards are not what the
 * user agreed to run, so they are asked again rather than silently obeyed.
 */
export async function withAppMcpClient<T>({
  credential,
  manifest,
  manifestHash,
  run,
  signal,
  slug,
}: {
  credential: null | string;
  manifest: LocalMcpAppManifest | McpAppManifest;
  manifestHash: string;
  run: (client: Client) => Promise<T>;
  signal?: AbortSignal;
  slug: string;
}): Promise<Result<T, McpConnectionError>> {
  if (manifest.type === "mcp") {
    return withMcpClient({
      authProvider: mcpAuthProviderForCommand(slug, manifest),
      config: mcpConnectionConfig(manifest, credential),
      run,
      signal,
    });
  }

  const connection = await readConnection(slug);
  if (connection?.approvedManifestHash !== manifestHash) {
    return err({
      message: `Running ${manifest.package} on this machine needs the user's go-ahead. Ask with connect_app; they see what would run and allow it.`,
      reason: "unapproved",
    });
  }

  const prepared = await prepareLocalServer({ manifest, signal, slug });
  if (prepared.isErr()) {
    return err({ message: prepared.error, reason: "connect" });
  }
  return withLocalMcpClient({
    launch: localLaunchConfig(prepared.value, manifest, credential),
    run,
  });
}
