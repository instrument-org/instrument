import path from "node:path";

import { nodeToolsEnvFor } from "./tool-isolation-env";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Where the app keeps what its own pnpm and node-gyp make and read: the
 * store, caches, config and the headers native builds compile against. Beside
 * uv's (`uvDataDir`), never in the person's own `~/.npm`, `~/.cache` or pnpm
 * store, so ours and theirs never share a byte in either direction.
 */
export function nodeToolsDir(): string {
  return path.join(path.dirname(getWorkspaceConfig().uvDataDir), "node-tools");
}

/** pnpm, npm and node-gyp pinned to the app's own folders and config. */
export function nodeToolsEnv(): Record<string, string> {
  return nodeToolsEnvFor(nodeToolsDir());
}
