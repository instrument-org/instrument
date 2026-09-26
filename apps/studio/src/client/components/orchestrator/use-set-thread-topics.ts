import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { threadListOptions } from "./thread-list-query";
import { type Thread } from "./threads";

/**
 * Files a thread under a set of topics, and paints the pills from the click
 * rather than from the round trip: the list beside the thread is a live read
 * of every thread's messages, re-run on the change, and the pill waiting on
 * that read made filing feel slow. The live read's next answer is the truth,
 * and replaces the paint either way.
 */
export function useSetThreadTopics() {
  const queryClient = useQueryClient();
  const key = threadListOptions().queryKey;
  const mutation = useMutation(
    rpcClient.workspace.orchestrator.threads.setTopics.mutationOptions({
      onError: (error) => {
        toast.error("Failed to tag the chat", {
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
    mutation.mutate({ sessionId, topics });
  };
}
