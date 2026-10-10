import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type ChatId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Stopping what the agent left running, on the user's behalf.
 *
 * Shared by the task header's list and by the `bash` card that started one, so
 * a process can be ended from wherever the user happens to be looking at it.
 * `busy` covers both mutations: a second press while one is in flight would be
 * asking a process that is already being stopped to stop.
 */
export function useStopBackgroundProcess(
  chatId: ChatId | undefined,
  /** One session's of the record alone: the chat's own, or a task's. */
  sessionId?: StoreId.Session,
) {
  const owner = sessionId ? { sessionId } : {};
  const { isPending: isStopping, mutate: stopOne } = useMutation(
    rpcClient.workspace.chats.backgroundProcesses.stop.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop it", { description: error.message });
      },
    }),
  );
  const { isPending: isStoppingAll, mutate: stopEvery } = useMutation(
    rpcClient.workspace.chats.backgroundProcesses.stopAll.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop them", { description: error.message });
      },
    }),
  );

  return {
    busy: isStopping || isStoppingAll,
    stop: (processId: string) => {
      if (chatId) {
        stopOne({ id: chatId, processId, ...owner });
      }
    },
    stopAll: () => {
      if (chatId) {
        stopEvery({ id: chatId, ...owner });
      }
    },
  };
}
