import { type Client } from "@modelcontextprotocol/sdk/client/index.js";

import { mcpServerGuidance, type McpServerGuidance } from "./client";

/**
 * What each MCP app's server last said about itself, by app and manifest,
 * noted from every connection a call makes. A gate decides before anything
 * connects, so it reads this, and connects only for an app no connection
 * has noted yet; a server that changes its words is noted changed on the
 * next call.
 */
const noted = new Map<string, McpServerGuidance>();

function key(slug: string, manifestHash: string): string {
  return `${slug}\u0000${manifestHash}`;
}

export function noteServerGuidance(
  slug: string,
  manifestHash: string,
  client: Client,
): McpServerGuidance {
  const guidance = mcpServerGuidance(client);
  noted.set(key(slug, manifestHash), guidance);
  return guidance;
}

export function notedServerGuidance(
  slug: string,
  manifestHash: string,
): McpServerGuidance | undefined {
  return noted.get(key(slug, manifestHash));
}
