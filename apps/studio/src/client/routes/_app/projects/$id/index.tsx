import type { RowSelectionState } from "@tanstack/react-table";

import { InternalLink } from "@/client/components/internal-link";
import { TaskDeleteDialog } from "@/client/components/task/delete-dialog";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { TasksDataTable } from "@/client/components/tasks-data-table";
import { createColumns } from "@/client/components/tasks-data-table/columns";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { createIconMeta } from "@/shared/tabs";
import {
  ProjectIdSchema,
  type Task,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/projects/$id/")({
  params: {
    parse: (rawParams) => ({ id: ProjectIdSchema.parse(rawParams.id) }),
  },
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Project" }, createIconMeta("table-properties")],
  }),
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();
  const { addTab } = useTabActions();

  const [page, setPage] = useState(1);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [taskToDelete, setTaskToDelete] = useState<null | Task>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<null | Task>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const { data: project, isLoading } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({ input: { id } }),
  );

  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions({
      input: { direction: "desc", sortBy: "updatedAt" },
    }),
  );

  const memberTasks = useMemo(
    () => (tasksData?.tasks ?? []).filter((task) => task.projectId === id),
    [tasksData?.tasks, id],
  );

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );
  const pinnedTaskIdSet = useMemo(
    () => new Set<TaskId>(pinnedTaskIds),
    [pinnedTaskIds],
  );

  const stopSessionMutation = useMutation(
    rpcClient.workspace.session.stop.mutationOptions(),
  );

  const handleStop = useCallback(
    (taskId: TaskId) => {
      stopSessionMutation.mutate(
        { id: taskId },
        {
          onError: () => {
            toast.error("Failed to stop session");
          },
        },
      );
    },
    [stopSessionMutation],
  );

  const handleOpenInNewTab = useCallback(
    (taskId: TaskId) => {
      void addTab(
        { params: { id: taskId }, to: "/tasks/$id" },
        { select: true },
      );
    },
    [addTab],
  );

  const handleDelete = useCallback(
    (taskId: TaskId) => {
      const task = memberTasks.find((t) => t.id === taskId);
      if (task) {
        setTaskToDelete(task);
        setDeleteDialogOpen(true);
      }
    },
    [memberTasks],
  );

  const handleSettings = useCallback(
    (taskId: TaskId) => {
      const task = memberTasks.find((t) => t.id === taskId);
      if (task) {
        setTaskToEdit(task);
        setSettingsDialogOpen(true);
      }
    },
    [memberTasks],
  );

  const columns = useMemo(
    () =>
      createColumns({
        onDelete: handleDelete,
        onOpenInNewTab: handleOpenInNewTab,
        onSettings: handleSettings,
        onStop: handleStop,
        pinnedTaskIds: pinnedTaskIdSet,
      }),
    [
      handleDelete,
      handleOpenInNewTab,
      handleSettings,
      handleStop,
      pinnedTaskIdSet,
    ],
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex min-w-0 flex-col gap-y-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <InternalLink to="/new-tab">New task</InternalLink>
        </Button>
      </div>

      <div className="mt-8">
        <TasksDataTable
          columns={columns}
          data={memberTasks}
          onPageChange={setPage}
          onRowSelectionChange={setRowSelection}
          page={page}
          rowSelection={rowSelection}
        />
      </div>

      {taskToDelete && (
        <TaskDeleteDialog
          navigateOnDelete={false}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              setTaskToDelete(null);
            }
          }}
          open={deleteDialogOpen}
          task={taskToDelete}
        />
      )}

      {taskToEdit && (
        <TaskSettingsDialog
          onOpenChange={(open) => {
            setSettingsDialogOpen(open);
            if (!open) {
              setTaskToEdit(null);
            }
          }}
          open={settingsDialogOpen}
          task={taskToEdit}
        />
      )}
    </div>
  );
}
