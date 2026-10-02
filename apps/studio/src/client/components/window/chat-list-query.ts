import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";

/**
 * The window's live chat list, with what every reader of it shares:
 * a chat that did not change keeps its object across updates, dates and
 * all, so the rows memoized on it stay put when another chat moves. Every
 * reader passes the same options, since the one query holds one set.
 */
export function chatListOptions() {
  return rpcClient.workspace.chats.live.list.experimental_liveOptions({
    structuralSharing: shareEqualDeep,
  });
}
