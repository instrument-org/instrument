import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
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
export function useStopBackgroundProcess(taskId: TaskId | undefined) {
  const { isPending: isStopping, mutate: stopOne } = useMutation(
    rpcClient.workspace.task.backgroundProcesses.stop.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop it", { description: error.message });
      },
    }),
  );
  const { isPending: isStoppingAll, mutate: stopEvery } = useMutation(
    rpcClient.workspace.task.backgroundProcesses.stopAll.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop them", { description: error.message });
      },
    }),
  );

  return {
    busy: isStopping || isStoppingAll,
    stop: (processId: string) => {
      if (taskId) {
        stopOne({ id: taskId, processId });
      }
    },
    stopAll: () => {
      if (taskId) {
        stopEvery({ id: taskId });
      }
    },
  };
}
