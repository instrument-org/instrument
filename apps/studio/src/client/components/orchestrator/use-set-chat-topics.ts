import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";

/**
 * Files a chat under a set of topics, and paints the pills from the click
 * rather than from the round trip: the list beside the chat is a live read
 * of every chat's messages, re-run on the change, and the pill waiting on
 * that read made filing feel slow. The live read's next answer is the truth,
 * and replaces the paint either way.
 */
export function useSetChatTopics() {
  const queryClient = useQueryClient();
  const key = chatListOptions().queryKey;
  const mutation = useMutation(
    rpcClient.workspace.orchestrator.chats.setTopics.mutationOptions({
      onError: (error) => {
        toast.error("Failed to tag the chat", {
          description: error.message,
        });
        void queryClient.invalidateQueries({ queryKey: key });
      },
      onMutate: (input) => {
        queryClient.setQueryData<Chat[]>(key, (chats) =>
          chats?.map((chat) =>
            chat.id === input.sessionId
              ? { ...chat, topics: input.topics }
              : chat,
          ),
        );
      },
    }),
  );
  return (sessionId: StoreId.Session, topics: string[]) => {
    mutation.mutate({ sessionId, topics });
  };
}
