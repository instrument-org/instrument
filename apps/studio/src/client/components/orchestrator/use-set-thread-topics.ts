import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { type Thread } from "./threads";

/**
 * Files a thread under a set of topics, and paints the pills from the click
 * rather than from the round trip: the list beside the thread is a live read
 * of every thread's messages, re-run on the change, and the pill waiting on
 * that read made filing feel slow. The live read's next answer is the truth,
 * and replaces the paint either way.
 */
export function useSetThreadTopics(taskId: TaskId | undefined) {
  const queryClient = useQueryClient();
  const key =
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: taskId ? { id: taskId } : skipToken },
    ).queryKey;
  const mutation = useMutation(
    rpcClient.workspace.orchestrator.threads.setTopics.mutationOptions({
      onError: (error) => {
        toast.error("Failed to tag the thread", {
          description: error.message,
        });
        void queryClient.invalidateQueries({ queryKey: key });
      },
      onMutate: (input) => {
        queryClient.setQueryData<Thread[]>(key, (threads) =>
          threads?.map((thread) =>
            thread.id === input.sessionId
              ? { ...thread, topics: input.topics }
              : thread,
          ),
        );
      },
    }),
  );
  return (sessionId: StoreId.Session, topics: string[]) => {
    if (taskId) {
      mutation.mutate({ id: taskId, sessionId, topics });
    }
  };
}
