import { rpcClient } from "@/client/rpc/client";
import {
  applyFolderPatch,
  type ChatId,
  type ComputerFolder,
  type ComputerFolderEvent,
} from "@instrument-org/workspace/client";
import {
  type Query,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  queryOptions,
  skipToken,
  type SkipToken,
} from "@tanstack/react-query";

/** The streams keeping a folder's listing current, by the listing's query hash. */
const streams = new Map<string, AbortController>();

/** The query clients whose cache is watched for listings nobody shows any longer. */
const watchedCaches = new WeakSet<QueryClient>();

/**
 * The options every reader of a folder's listing uses, so whichever reader's
 * read runs, the cache entry gets the same answer: the folder whole from the
 * main process (`computer.live.list`), and then, while a reader marked
 * `follow` is enabled, every change to it as a patch written into the entry.
 * The stream ends once no following reader is enabled (a tab gone behind
 * another), and the listing then goes stale, so the next one enabled reads
 * it again. `staleMs` is how long a listing read without a stream stays
 * fresh for a reader that does not follow it.
 */
export function computerFolderOptions(
  input: { id: ChatId; path: string } | SkipToken,
  { follow = false, staleMs = 0 }: { follow?: boolean; staleMs?: number } = {},
) {
  const queryFn: QueryFunction<ComputerFolder> | SkipToken =
    input === skipToken ? skipToken : readFolder(input);
  return queryOptions({
    enabled: input !== skipToken,
    meta: follow ? { followsFolder: true } : undefined,
    queryFn,
    queryKey: rpcClient.workspace.computer.list.queryKey({ input }),
    retry: false,
    // Current while its stream runs; stale once it has ended.
    staleTime: (query: { queryHash: string }) =>
      streams.has(query.queryHash)
        ? Number.POSITIVE_INFINITY
        : follow
          ? 0
          : staleMs,
  });
}

/** The read of a folder that keeps a stream on it while a reader follows it. */
function readFolder(input: {
  id: ChatId;
  path: string;
}): QueryFunction<ComputerFolder> {
  return async ({ client, queryKey: key, signal }) => {
    watchCache(client);
    const hash = hashOf(client, key);
    endStream(hash);
    const controller = new AbortController();
    // Until the folder's first answer is in, the read is the query's to end.
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const events = await rpcClient.workspace.computer.live.list.call(input, {
        signal: controller.signal,
      });
      const first = await events.next();
      if (first.done || first.value.kind !== "snapshot") {
        controller.abort();
        throw new Error("A folder's live listing sent no folder first");
      }
      // A read with no reader following the folder by the time it is in
      // keeps no stream.
      if (
        isFollowed(client.getQueryCache().find({ exact: true, queryKey: key }))
      ) {
        streams.set(hash, controller);
        void keepUp({ client, controller, events, hash, queryKey: key });
      } else {
        controller.abort();
        await events.return?.().catch(() => undefined);
      }
      return first.value.folder;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}

/** Whether a reader marked `follow` is enabled on the listing. */
function isFollowed(query: Query | undefined) {
  return (
    query?.observers.some(
      ({ options }) =>
        options.meta?.followsFolder === true &&
        (typeof options.enabled === "function"
          ? options.enabled(query)
          : options.enabled) !== false,
    ) ?? false
  );
}

/** Writes each change the stream sends into the folder's cache entry. */
async function keepUp({
  client,
  controller,
  events,
  hash,
  queryKey,
}: {
  client: QueryClient;
  controller: AbortController;
  events: AsyncIterator<ComputerFolderEvent>;
  hash: string;
  queryKey: QueryKey;
}) {
  try {
    await answered(client, queryKey);
    while (!controller.signal.aborted) {
      const next = await events.next();
      // A stream ended while a change was on its way leaves that change to
      // the read after it. A tab read while behind another turns its reader
      // off once the read is in, which the cache says nothing of.
      if (
        next.done ||
        controller.signal.aborted ||
        !isFollowed(client.getQueryCache().find({ exact: true, queryKey }))
      ) {
        break;
      }
      const folder = applyFolderPatch(
        client.getQueryData<ComputerFolder>(queryKey),
        next.value,
      );
      if (folder === undefined) {
        // A patch to a folder held as something else: only a read answers.
        void client.invalidateQueries({ exact: true, queryKey });
        break;
      }
      client.setQueryData(queryKey, folder);
    }
  } catch {
    // The folder went, or the stream broke: a read says which, and a gone
    // folder's read fails the way the page expects.
    if (!controller.signal.aborted) {
      void client.invalidateQueries({ exact: true, queryKey });
    }
  } finally {
    controller.abort();
    await events.return?.().catch(() => undefined);
    if (streams.get(hash) === controller) {
      streams.delete(hash);
    }
  }
}

/**
 * Resolves once the read that opened a folder's stream has written its
 * answer into the cache, which would otherwise land on top of a change sent
 * straight after it.
 */
function answered(client: QueryClient, queryKey: QueryKey) {
  const cache = client.getQueryCache();
  const query = cache.find({ exact: true, queryKey });
  return new Promise<void>((resolve) => {
    if (query === undefined || query.state.fetchStatus === "idle") {
      resolve();
      return;
    }
    const unsubscribe = cache.subscribe((event) => {
      if (
        event.query === query &&
        (event.type === "removed" || query.state.fetchStatus === "idle")
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Ends a folder's stream as soon as no following reader is enabled, rather
 * than at its next change: a tab gone behind another turns its readers off,
 * and a closed one takes them away.
 */
function watchCache(client: QueryClient) {
  if (watchedCaches.has(client)) {
    return;
  }
  watchedCaches.add(client);
  client.getQueryCache().subscribe((event) => {
    if (
      event.type !== "observerRemoved" &&
      event.type !== "observerOptionsUpdated" &&
      event.type !== "removed"
    ) {
      return;
    }
    if (event.type === "removed" || !isFollowed(event.query)) {
      endStream(event.query.queryHash);
    }
  });
}

/**
 * Ends a folder's stream and forgets it at once, so the listing is stale
 * from this moment: a tab brought back up before the stream has wound down
 * still reads the folder again.
 */
function endStream(hash: string) {
  streams.get(hash)?.abort();
  streams.delete(hash);
}

/** A query key's hash as the cache keys its entry. */
function hashOf(client: QueryClient, queryKey: QueryKey) {
  return (
    client.getQueryCache().find({ exact: true, queryKey })?.queryHash ??
    JSON.stringify(queryKey)
  );
}
