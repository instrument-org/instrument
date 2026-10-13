import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

export function useChatActivity({ id }: { id: ChatId }) {
  return useQuery({
    ...rpcClient.workspace.chats.live.activity.experimental_liveOptions(),
    select: (activity) => activity.find((entry) => entry.chatId === id),
  });
}
