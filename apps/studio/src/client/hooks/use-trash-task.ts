import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { rpcClient } from "../rpc/client";
import { useTabActions } from "./use-tab-actions";
import { useTabs } from "./use-tabs";

export function useTrashTask({
  navigateOnDelete,
}: {
  navigateOnDelete?: boolean;
}) {
  const queryClient = useQueryClient();
  const trashTaskMutation = useMutation(
    rpcClient.workspace.task.trash.mutationOptions(),
  );
  const { closeTab } = useTabActions();
  const tabs = useTabs();
  const navigate = useNavigate();

  const trashTask = useCallback(
    async (taskId: TaskId) => {
      await trashTaskMutation.mutateAsync({
        id: taskId,
      });

      // removeQueries silently destroys the query without notifying active
      // observers, so mounted components (e.g. the sidebar) keep rendering
      // stale data until something unrelated forces a re-render.
      // invalidateQueries refetches active observers in the background,
      // keeping their current data until the refetch resolves (unlike
      // resetQueries, which clears data to a loading state first).
      void queryClient.invalidateQueries({
        // .key() generates a wildcard key for any params
        queryKey: rpcClient.workspace.task.live.list.key(),
      });
      void queryClient.invalidateQueries({
        // .key() generates a wildcard key for any params
        queryKey: rpcClient.workspace.task.agentStatus.byIds.key(),
      });

      if (navigateOnDelete) {
        await navigate({ replace: true, to: "/new-tab" });
      } else {
        const taskTabs = tabs.filter((tab) => tab.taskId === taskId);

        for (const tab of taskTabs) {
          await closeTab({ id: tab.id });
        }
      }
    },
    [
      trashTaskMutation,
      queryClient,
      tabs,
      closeTab,
      navigate,
      navigateOnDelete,
    ],
  );

  return {
    error: trashTaskMutation.error,
    isPending: trashTaskMutation.isPending,
    trashTask,
  };
}
