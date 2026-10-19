import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";

/**
 * Files a chat under a topic, or under none with `null`, and paints the
 * pill from the click rather than from the round trip: the list beside the
 * chat is a live read of every chat's messages, re-run on the change, and
 * the pill waiting on that read made filing feel slow. The live read's next
 * answer is the truth, and replaces the paint either way.
 */
export function useSetChatTopic() {
  const queryClient = useQueryClient();
  const key = chatListOptions().queryKey;
  const mutation = useMutation(
    rpcClient.workspace.chats.setTopic.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change the chat's topic", { cause: error });
        void queryClient.invalidateQueries({ queryKey: key });
      },
      onMutate: (input) => {
        queryClient.setQueryData<Chat[]>(key, (chats) =>
          chats?.map((chat) => {
            if (chat.id !== input.id) {
              return chat;
            }
            const { topic: _was, ...rest } = chat;
            return input.topic ? { ...rest, topic: input.topic } : rest;
          }),
        );
      },
    }),
  );
  return (id: ChatId, topic: null | string) => {
    mutation.mutate({ id, topic });
  };
}
