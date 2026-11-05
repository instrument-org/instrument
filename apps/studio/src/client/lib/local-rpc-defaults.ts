import { type DefaultOptions } from "@tanstack/react-query";

/**
 * Defaults for a renderer's query client, whose requests go to this computer's
 * main process. Almost all of them are answered there, so a retry wouldn't
 * change the answer, and the network being down is no reason to wait: the
 * library's default holds every request, a settings write included, for as long
 * as the browser thinks it's offline. The routes only a server can answer say
 * so in `rpc/client.ts`. Coming back online still reads a stale query again,
 * which `networkMode: "always"` would otherwise turn off.
 */
export const LOCAL_RPC_DEFAULTS = {
  mutations: { networkMode: "always" },
  queries: { networkMode: "always", refetchOnReconnect: true, retry: 0 },
} satisfies DefaultOptions;
