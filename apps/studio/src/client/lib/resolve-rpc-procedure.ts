interface RpcProcedure {
  call: (input?: unknown) => Promise<unknown>;
}

// Walks a dot-separated path (e.g. "workspace.debug.replaySession") down the
// RPC client's nested procedure tree. The tree's shape comes from the router
// and can't be indexed by an arbitrary runtime string in its own types, so
// this narrows with runtime checks at each step instead of casting through
// the real type. Existence is checked via direct property access rather than
// the `in` operator: oRPC's client is a Proxy that lazily builds nested
// clients in its `get` trap without implementing a `has` trap, so `in`
// reports every path as missing even though accessing it works fine.
export function resolveRpcProcedure(root: unknown, path: string): RpcProcedure {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid RPC path: "${path}"`);
  }

  let node: unknown = root;
  for (const segment of segments) {
    if (typeof node !== "object" || node === null) {
      throw new Error(`Unknown RPC path segment "${segment}" in "${path}"`);
    }
    node = (node as Record<string, unknown>)[segment];
    if (node === undefined) {
      throw new Error(`Unknown RPC path segment "${segment}" in "${path}"`);
    }
  }

  if (
    typeof node !== "object" ||
    node === null ||
    typeof (node as { call?: unknown }).call !== "function"
  ) {
    throw new Error(`"${path}" is not a callable RPC procedure`);
  }

  return node as RpcProcedure;
}
