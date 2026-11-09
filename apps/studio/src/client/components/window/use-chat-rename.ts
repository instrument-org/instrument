import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

import { type ChatRowPainting, paintChatRow } from "./chat-list-query";
import { type Chat } from "./chats";

export type ChatRename = ReturnType<typeof useChatRename>;

/**
 * Renaming a chat from its title: typed by the user, or named afresh from
 * the conversation by the sparkle inside the field, the one way a chat is
 * renamed from what was said in it rather than by what the user typed.
 * Either one settles the title, so the app never renames the chat after.
 * The new name is painted onto the chat's row in the list until the list
 * has it, so the field closes onto it at once.
 */
export function useChatRename(chat: Chat | undefined) {
  const queryClient = useQueryClient();
  const { mutateAsync: renameChat } = useMutation(
    rpcClient.workspace.chats.rename.mutationOptions<ChatRowPainting>({
      onError: (error, _input, painting) => {
        painting?.failed();
        toast.error("Couldn't rename the chat", { cause: error });
      },
      onMutate: (input) =>
        paintChatRow(queryClient, input.id, {
          title: input.title,
          titleByApp: false,
        }),
      onSuccess: (at, _input, painting) => {
        painting.landed(at);
      },
    }),
  );
  const retitle = useMutation(
    rpcClient.workspace.chats.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't rename the chat", { cause: error });
      },
    }),
  );
  const inline = useInlineRename({
    onSave: async (title) => {
      if (chat) {
        await renameChat({ id: chat.id, title });
      }
    },
    value: chat?.title ?? "",
  });
  const suggest = async () => {
    if (!chat) {
      return;
    }
    let named: Awaited<ReturnType<typeof retitle.mutateAsync>>;
    try {
      named = await retitle.mutateAsync({ id: chat.id });
    } catch {
      // Toasted by the mutation; the field stays open.
      return;
    }
    const { listed, title } = named;
    if (title === undefined) {
      toast("Nothing to name it from yet");
    } else if (title === chat.title) {
      toast("The name still fits");
    } else {
      paintChatRow(queryClient, chat.id, { title }).landed(listed);
    }
    inline.cancel();
  };
  return {
    ...inline,
    isSuggesting: retitle.isPending,
    suggest: () => {
      void suggest();
    },
  };
}
