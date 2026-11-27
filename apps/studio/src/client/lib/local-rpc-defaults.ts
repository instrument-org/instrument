import { type DefaultOptions, type QueryKey } from "@tanstack/react-query";

/** The `type` an RPC query's key names for a one-shot read (`rpcClient.….queryKey()`). */
const ONE_SHOT_READS = new Set<unknown>(["infinite", "query"]);

/**
 * How long a read stays fresh. A one-shot RPC read stays fresh until
 * something invalidates it, so a mount or a window coming forward reads the
 * cache rather than asking main again; a read whose answer moves with
 * nothing to invalidate it (the system, files changed outside the app, a
 * server) says so in `rpc/client.ts`. Every other read, a live one or a
 * stream behind a `queryFn` of its own, is stale at once: a stream ends with
 * its last observer, and the next mount starts it again only over stale data.
 */
function staleTime({ queryKey }: { queryKey: QueryKey }) {
  const [, options] = queryKey;
  return typeof options === "object" &&
    options !== null &&
    "type" in options &&
    ONE_SHOT_READS.has(options.type)
    ? Number.POSITIVE_INFINITY
    : 0;
}

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
  queries: {
    networkMode: "always",
    refetchOnReconnect: true,
    retry: 0,
    staleTime,
  },
} satisfies DefaultOptions;
