import { rpcClient } from "@/client/rpc/client";
import {
  applyFeedEvent,
  applyOlder,
  type ChatId,
  type StoreId,
  type TranscriptFeed,
} from "@instrument-org/workspace/client";
import {
  hashKey,
  type QueryClient,
  queryOptions,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

interface FeedInput {
  id: ChatId;
  sessionId: StoreId.Session;
}

/**
 * A session's transcript, kept current by `message.live.feed`: the first event
 * is its end and each after it only what moved, merged into what the query
 * holds, so the messages that did not move keep their objects. Nothing is
 * read without a session.
 */
export function transcriptFeedOptions(input: FeedInput | undefined) {
  const queryKey = ["transcript-feed", input?.id, input?.sessionId] as const;
  return queryOptions({
    queryFn:
      input === undefined
        ? skipToken
        : async ({ client, signal }): Promise<TranscriptFeed> => {
            const events = await rpcClient.workspace.message.live.feed.call(
              input,
              {
                signal,
              },
            );
            let feed: TranscriptFeed | undefined;
            for await (const event of events) {
              if (signal.aborted) {
                throw signal.reason;
              }
              // From what the query holds, which has the older turns asked for since.
              feed = applyFeedEvent(
                client.getQueryData<TranscriptFeed>(queryKey),
                event,
              );
              client.setQueryData(queryKey, feed);
            }
            if (!feed) {
              throw new Error(
                "The transcript's feed closed before it sent anything.",
              );
            }
            return feed;
          },
    queryKey,
    retry: 1,
  });
}

/** The request out for the page above what each feed holds, by its query's key. */
const olderPages = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/**
 * Puts the page before what the query holds above it. A feed has one such
 * request out at a time, and everyone asking while it is out waits on it, so
 * no page is asked for twice. Nothing is asked when no turns are above.
 */
function olderPage(client: QueryClient, input: FeedInput): Promise<void> {
  const { queryKey } = transcriptFeedOptions(input);
  const key = hashKey(queryKey);
  const pages = olderPages.get(client) ?? new Map<string, Promise<void>>();
  olderPages.set(client, pages);
  const out = pages.get(key);
  if (out) {
    return out;
  }
  const held = client.getQueryData(queryKey);
  const before = held?.messages[0]?.id;
  if (!held?.hasOlder || before === undefined) {
    return Promise.resolve();
  }
  const page = rpcClient.workspace.message.older
    .call({ ...input, before })
    .then((older) => {
      client.setQueryData(queryKey, (current) => applyOlder(current, older));
    })
    .finally(() => {
      pages.delete(key);
    });
  pages.set(key, page);
  return page;
}

/** A session's transcript, and asking for the turns above what it holds. */
export function useTranscriptFeed(
  input: FeedInput,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const options = transcriptFeedOptions(input);
  const query = useQuery({ ...options, enabled });
  const client = useQueryClient();
  // How many of this hook's loads are waiting on a page, so the flag stays up
  // until the last of them ends.
  const [olderLoads, setOlderLoads] = useState(0);
  const isLoadingOlder = olderLoads > 0;
  const whileLoadingOlder = <T>(load: Promise<T>): Promise<T> => {
    setOlderLoads((count) => count + 1);
    // A promise's `finally` rather than a `try` one, which the React
    // Compiler does not lower yet.
    return load.finally(() => {
      setOlderLoads((count) => count - 1);
    });
  };
  const first = query.data?.messages[0]?.id;
  const loadOlder = () => {
    if (isLoadingOlder || first === undefined || !query.data?.hasOlder) {
      return;
    }
    void whileLoadingOlder(olderPage(client, input));
  };
  /**
   * Asks for pages before what the query holds until it holds `id`, or there
   * are none left; says whether it holds it then.
   */
  const loadOlderThrough = (id: StoreId.Message): Promise<boolean> => {
    const held = () => client.getQueryData<TranscriptFeed>(options.queryKey);
    const loadThrough = async (): Promise<boolean> => {
      while (!held()?.messages.some((message) => message.id === id)) {
        if (!held()?.hasOlder || held()?.messages[0] === undefined) {
          return false;
        }
        await olderPage(client, input);
      }
      return true;
    };
    return whileLoadingOlder(loadThrough());
  };
  return { ...query, isLoadingOlder, loadOlder, loadOlderThrough };
}
