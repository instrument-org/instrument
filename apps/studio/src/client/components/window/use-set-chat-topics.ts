import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

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
    rpcClient.workspace.chats.setTopics.mutationOptions({
      onError: (error) => {
        toast.error("Failed to tag the chat", {
          description: error.message,
        });
        void queryClient.invalidateQueries({ queryKey: key });
      },
      onMutate: (input) => {
        queryClient.setQueryData<Chat[]>(key, (chats) =>
          chats?.map((chat) =>
            chat.id === input.id ? { ...chat, topics: input.topics } : chat,
          ),
        );
      },
    }),
  );
  return (id: ChatId, topics: string[]) => {
    mutation.mutate({ id, topics });
  };
}
