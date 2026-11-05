import { rpcClient } from "@/client/rpc/client";
import {
  applyFeedEvent,
  applyOlder,
  type ChatId,
  type StoreId,
  type TranscriptFeed,
} from "@instrument-org/workspace/client";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface FeedInput {
  id: ChatId;
  isDeveloperMode: boolean;
  sessionId: StoreId.Session;
}

/**
 * A session's transcript, kept current by `message.live.feed`: the first event
 * is its end and each after it only what moved, merged into what the query
 * holds, so the messages that did not move keep their objects.
 */
export function transcriptFeedOptions(input: FeedInput) {
  const queryKey = [
    "transcript-feed",
    input.id,
    input.sessionId,
    input.isDeveloperMode,
  ] as const;
  return queryOptions({
    queryFn: async ({ client, signal }): Promise<TranscriptFeed> => {
      const events = await rpcClient.workspace.message.live.feed.call(input, {
        signal,
      });
      let feed: TranscriptFeed | undefined;
      for await (const event of events) {
        if (signal.aborted) {
          throw signal.reason;
        }
        feed = applyFeedEvent(feed, event);
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
  return { ...query, isLoadingOlder, loadOlder };
}
