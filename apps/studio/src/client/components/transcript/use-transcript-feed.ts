import { rpcClient } from "@/client/rpc/client";
import {
  applyFeedEvent,
  applyOlder,
  type ChatId,
  type StoreId,
  type TranscriptFeed,
} from "@instrument-org/workspace/client";
import {
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

/** A session's transcript, and asking for the turns above what it holds. */
export function useTranscriptFeed(
  input: FeedInput,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const options = transcriptFeedOptions(input);
  const query = useQuery({ ...options, enabled });
  const client = useQueryClient();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const first = query.data?.messages[0]?.id;
  const loadOlder = () => {
    if (isLoadingOlder || first === undefined || !query.data?.hasOlder) {
      return;
    }
    setIsLoadingOlder(true);
    void rpcClient.workspace.message.older
      .call({ ...input, before: first })
      .then((older) => {
        client.setQueryData(options.queryKey, (current) =>
          applyOlder(current, older),
        );
      })
      .finally(() => {
        setIsLoadingOlder(false);
      });
  };
  /**
   * Asks for pages before what the query holds until it holds `id`, or there
   * are none left; says whether it holds it then.
   */
  const loadOlderThrough = async (id: StoreId.Message): Promise<boolean> => {
    setIsLoadingOlder(true);
    try {
      for (;;) {
        const held = client.getQueryData<TranscriptFeed>(options.queryKey);
        if (held?.messages.some((message) => message.id === id)) {
          return true;
        }
        const before = held?.messages[0]?.id;
        if (!held?.hasOlder || before === undefined) {
          return false;
        }
        const older = await rpcClient.workspace.message.older.call({
          ...input,
          before,
        });
        client.setQueryData(options.queryKey, (current) =>
          applyOlder(current, older),
        );
      }
    } finally {
      setIsLoadingOlder(false);
    }
  };
  return { ...query, isLoadingOlder, loadOlder, loadOlderThrough };
}
