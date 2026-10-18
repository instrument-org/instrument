import { nodeToolsEnvFor } from "./tool-isolation-env";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * pnpm, npm and node-gyp pinned to the app's own store and caches (the
 * headers native builds compile against among them), in the runtime
 * folder beside uv's, never in the person's own `~/.npm`, `~/.cache` or pnpm
 * store, so ours and theirs never share a byte in either direction.
 */
export function nodeToolsEnv(): Record<string, string> {
  return nodeToolsEnvFor(getWorkspaceConfig().runtimeDir);
}
