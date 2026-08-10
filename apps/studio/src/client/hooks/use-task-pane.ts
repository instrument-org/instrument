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

  const update = (change: (pane: TaskPane.Type) => TaskPane.Type) => {
    if (!taskId) {
      return;
    }

    const key = paneQueryKey(taskId);
    const current = queryClient.getQueryData<TaskState>(key);
    const next = change(current?.pane ?? TaskPane.EMPTY);

    // Paint from the click rather than from the round trip. The write comes
    // back through the live query and the two converge; an agent `show` that
    // lands in between arrives the same way and wins, which is the behavior
    // wanted anyway.
    queryClient.setQueryData<TaskState>(key, (prev) =>
      prev ? { ...prev, pane: next } : prev,
    );

    void safe(
      rpcClient.workspace.task.state.set.call({
        id: taskId,
        state: { pane: next },
      }),
    );
  };

  return {
    close: () => {
      update((pane) => ({ ...pane, open: false }));
    },
    closeTab: (key: string) => {
      update((pane) => TaskPane.closeTab(pane, key));
    },
    openBrowser: () => {
      update((pane) => TaskPane.openTabs(pane, [{ type: "browser" }]));
    },
    openFiles: (filePaths: string[]) => {
      update((pane) =>
        TaskPane.openTabs(pane, filePaths.map(TaskPane.fileTab)),
      );
    },
    selectTab: (key: string) => {
      update((pane) => TaskPane.selectTab(pane, key));
    },
    toggle: () => {
      update((pane) => ({ ...pane, open: !pane.open }));
    },
  };
}

function paneQueryKey(id: TaskId) {
  return rpcClient.workspace.task.state.live.get.experimental_liveKey({
    input: { id },
  });
}
