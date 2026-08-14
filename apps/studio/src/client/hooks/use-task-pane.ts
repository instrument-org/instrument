import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type TaskId, TaskPane } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

type TaskState = RPCOutput["workspace"]["task"]["state"]["get"];

/**
 * What the pane is showing, from the task state the route already subscribes
 * to. Extra observers share that one query, so a component reading this adds a
 * subscriber rather than a subscription.
 */
export function useTaskPane(taskId: TaskId | undefined): TaskPane.Type {
  const { data } = useQuery(
    rpcClient.workspace.task.state.live.get.experimental_liveOptions({
      input: taskId ? { id: taskId } : skipToken,
    }),
  );

  return data?.pane ?? TaskPane.EMPTY;
}

/**
 * The ways the user opens, closes, and switches tabs.
 *
 * Every one of them is a write to the same field `show` writes, which is what
 * makes the agent's opens and the user's opens one code path with one
 * reconciliation. Nothing here subscribes: a file card only needs the current
 * pane at the moment it is clicked, so these read the cache imperatively and a
 * transcript full of references costs no observers.
 *
 * `taskId` is optional because the transcript renders outside the task route
 * too (a previewed conversation, the debug scenarios), where a reference is
 * still worth drawing and clicking it has nowhere to go.
 */
export function useTaskPaneActions(taskId: TaskId | undefined) {
  const queryClient = useQueryClient();

  /**
   * Send what the user did, and paint what it will look like.
   *
   * The operation goes to the server rather than the resulting pane, because
   * `show` writes this same field from the agent's turn: a snapshot computed
   * here would erase a tab the agent opened between this read and this write.
   * The same reducer runs locally for the optimistic paint, where being a
   * moment stale costs a frame rather than a tab.
   */
  const apply = (operation: TaskPane.Operation) => {
    if (!taskId) {
      return;
    }

    const key = paneQueryKey(taskId);
    const current = queryClient.getQueryData<TaskState>(key);
    const optimistic = TaskPane.applyOperation(
      current?.pane ?? TaskPane.EMPTY,
      operation,
    );

    // Paint from the click rather than from the round trip.
    queryClient.setQueryData<TaskState>(key, (prev) =>
      prev ? { ...prev, pane: optimistic } : prev,
    );

    void (async () => {
      const { data, error } = await safe(
        rpcClient.workspace.task.state.applyPaneOperation.call({
          id: taskId,
          operation,
        }),
      );

      // The server's answer is authoritative: it applied this operation to
      // whatever the pane actually was, which is not necessarily what was
      // painted. On failure the optimistic paint is a lie, so drop it and let
      // the live query re-establish the truth.
      if (error) {
        void queryClient.invalidateQueries({ queryKey: key });
        return;
      }

      queryClient.setQueryData<TaskState>(key, (prev) =>
        prev ? { ...prev, pane: data } : prev,
      );
    })();
  };

  return {
    close: () => {
      apply({ type: "close" });
    },
    closeTab: (key: string) => {
      apply({ key, type: "closeTab" });
    },
    openFiles: (filePaths: string[]) => {
      apply({ filePaths, type: "openFiles" });
    },
    reorderTabs: (keys: string[]) => {
      apply({ keys, type: "reorderTabs" });
    },
    selectTab: (key: string) => {
      apply({ key, type: "selectTab" });
    },
    toggle: () => {
      apply({ type: "toggle" });
    },
  };
}

function paneQueryKey(id: TaskId) {
  return rpcClient.workspace.task.state.live.get.experimental_liveKey({
    input: { id },
  });
}
