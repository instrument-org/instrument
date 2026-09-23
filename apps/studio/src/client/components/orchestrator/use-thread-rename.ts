import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { sleep } from "radashi";
import { toast } from "sonner";

import { useOrchestrator } from "./context";
import { type Thread } from "./threads";

// Long enough for the live list to carry the new name before the field goes,
// so the old one does not flash back in between.
const SETTLE_MS = 250;

export type ThreadRename = ReturnType<typeof useThreadRename>;

/**
 * Renaming a thread from its title: typed by the user, or named afresh from
 * the conversation by the sparkle inside the field, the one way a thread is
 * renamed from what was said in it rather than by what the user typed.
 * Either one settles the title, so the app never renames the thread after.
 */
export function useThreadRename(thread: Thread | undefined) {
  const { taskId } = useOrchestrator();
  const { mutateAsync: renameThread } = useMutation(
    rpcClient.workspace.orchestrator.threads.rename.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the thread", {
          description: error.message,
        });
      },
    }),
  );
  const retitle = useMutation(
    rpcClient.workspace.orchestrator.threads.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the thread", {
          description: error.message,
        });
      },
    }),
  );
  const inline = useInlineRename({
    onSave: async (title) => {
      if (thread) {
        await renameThread({ id: taskId, sessionId: thread.id, title });
      }
    },
    value: thread?.title ?? "",
  });
  const suggest = async () => {
    if (!thread) {
      return;
    }
    let title: string | undefined;
    try {
      ({ title } = await retitle.mutateAsync({
        id: taskId,
        sessionId: thread.id,
      }));
    } catch {
      // Toasted by the mutation; the field stays open.
      return;
    }
    if (title === undefined) {
      toast("Nothing to name it from yet");
    } else if (title === thread.title) {
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
