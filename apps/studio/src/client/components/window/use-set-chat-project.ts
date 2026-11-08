import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

import { type ChatRowPainting, paintChatRow } from "./chat-list-query";

/**
 * Files a chat under a project, or under none with `null`, and paints the
 * pill from the click rather than from the round trip: the list beside the
 * chat is a live read of every chat's messages, re-run on the change, and
 * the pill waiting on that read made filing feel slow.
 */
export function useSetChatProject() {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    rpcClient.workspace.chats.setProject.mutationOptions<ChatRowPainting>({
      onError: (error, _input, painting) => {
        painting?.failed();
        toast.error("Couldn't change the chat's project", { cause: error });
      },
      onMutate: (input) =>
        paintChatRow(queryClient, input.id, {
          project: input.project ?? undefined,
        }),
      onSuccess: (at, _input, painting) => {
        painting.landed(at);
      },
    }),
  );
  return (id: ChatId, project: null | string) => {
    mutation.mutate({ id, project });
  };
}
