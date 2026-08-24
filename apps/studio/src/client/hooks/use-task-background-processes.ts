import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Whether the process a promoted `bash` call handed back is still running.
 *
 * Read live rather than from the tool part, which was written the moment the
 * call yielded and says `processId` forever. A card built on that alone would
 * still be claiming a dev server was up the next morning, when the registry it
 * belonged to died with the app.
 */
export function useIsBackgroundProcessRunning({
  processId,
  taskId,
}: {
  processId: string | undefined;
  taskId: TaskId;
}) {
  const processes = useTaskBackgroundProcesses(taskId);
  return (
    processId !== undefined &&
    processes.some((process) => process.id === processId)
  );
}

/**
 * What this task still has running, kept current.
 *
 * Shared by the header pill and by the transcript, which need the same answer
 * for different reasons: the pill is asking whether to draw at all, and a
 * promoted `bash` row is asking whether it is still the live thing it was when
 * the call returned. Both read one query key, so a transcript full of promoted
 * calls costs a single request however many rows ask.
 *
 * The subscription is the reason this is a hook rather than a call: the registry
 * lives in the main process, nothing about a running process reaches the store,
 * and only `backgroundProcesses.changed` says when the set moved.
 */
export function useTaskBackgroundProcesses(taskId: TaskId) {
  const queryClient = useQueryClient();

  const { data: processes } = useQuery(
    rpcClient.workspace.task.backgroundProcesses.list.queryOptions({
      input: { id: taskId },
    }),
  );

  // A revision counter, not the list: the popover is usually closed, and what
  // changes is whether anything is running at all.
  const { data: changed } = useQuery(
    rpcClient.workspace.task.backgroundProcesses.events.changed.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const revision = changed?.revision;
  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.task.backgroundProcesses.key(),
    });
  }, [revision, queryClient]);

  return processes ?? [];
}
