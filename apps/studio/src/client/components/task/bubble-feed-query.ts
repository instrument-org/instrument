import { rpcClient } from "@/client/rpc/client";
import {
  applyBubbleFeedEvent,
  type BubbleFeed,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";
import { queryOptions } from "@tanstack/react-query";

/**
 * A session's bubbles, kept current by `message.live.bubbles`: the first
 * event is the whole feed and each after it only what moved, merged into the
 * feed the query holds, so the messages that did not move keep their objects.
 */
export function bubbleFeedOptions(input: {
  id: ChatId;
  sessionId: StoreId.Session;
}) {
  const queryKey = ["bubble-feed", input.id, input.sessionId] as const;
  return queryOptions({
    queryFn: async ({ client, signal }): Promise<BubbleFeed> => {
      const events = await rpcClient.workspace.message.live.bubbles.call(
        input,
        { signal },
      );
      let feed: BubbleFeed | undefined;
      for await (const event of events) {
        if (signal.aborted) {
          throw signal.reason;
        }
        feed = applyBubbleFeedEvent(feed, event);
        client.setQueryData(queryKey, feed);
      }
      if (!feed) {
        throw new Error(
          "The conversation's feed closed before it sent anything.",
        );
      }
      return feed;
    },
    queryKey,
    retry: 1,
  });
}
