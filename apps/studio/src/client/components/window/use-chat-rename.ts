import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { sleep } from "radashi";
import { toast } from "@/client/lib/toast";

import { type Chat } from "./chats";

// Long enough for the live list to carry the new name before the field goes,
// so the old one does not flash back in between.
const SETTLE_MS = 250;

export type ChatRename = ReturnType<typeof useChatRename>;

/**
 * Renaming a chat from its title: typed by the user, or named afresh from
 * the conversation by the sparkle inside the field, the one way a chat is
 * renamed from what was said in it rather than by what the user typed.
 * Either one settles the title, so the app never renames the chat after.
 */
export function useChatRename(chat: Chat | undefined) {
  const { mutateAsync: renameChat } = useMutation(
    rpcClient.workspace.chats.rename.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the chat", {
          description: error.message,
        });
      },
    }),
  );
  const retitle = useMutation(
    rpcClient.workspace.chats.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the chat", {
          description: error.message,
        });
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
    let title: string | undefined;
    try {
      ({ title } = await retitle.mutateAsync({ id: chat.id }));
    } catch {
      // Toasted by the mutation; the field stays open.
      return;
    }
    if (title === undefined) {
      toast("Nothing to name it from yet");
    } else if (title === chat.title) {
      toast("The name still fits");
    }
    await sleep(SETTLE_MS);
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
