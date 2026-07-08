import { rpcClient } from "@/client/rpc/client";

import { resolveRpcProcedure } from "./resolve-rpc-procedure";

declare global {
  interface Window {
    __studioDebug?: DebugBridge;
  }
}

interface DebugBridge {
  rpc: (path: string, input?: unknown) => Promise<unknown>;
}

/**
 * Dev-only console bridge: lets a Chrome DevTools session invoke any oRPC
 * route directly -- `window.__studioDebug.rpc("workspace.debug.replaySession", {...})`
 * -- instead of driving the same action through UI clicks. Gated at call
 * time (not attach time) on the live Developer Mode preference, so toggling
 * the setting takes effect without a reload.
 */
export function initDebugRpcBridge() {
  window.__studioDebug = { rpc: callRoute };
}

async function callRoute(path: string, input?: unknown): Promise<unknown> {
  const preferences = await rpcClient.preferences.get.call();
  if (!preferences.developerMode) {
    throw new Error(
      "window.__studioDebug.rpc requires Developer Mode (Settings > General)",
    );
  }
  return await resolveRpcProcedure(rpcClient, path).call(input);
}
