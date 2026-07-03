import type { RowSelectionState } from "@tanstack/react-table";

import { openDeleteTask } from "@/client/atoms/delete-task-modal";
import { CommandMenuCTA } from "@/client/components/command-menu-cta";
import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { InternalLink } from "@/client/components/internal-link";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import {
  TASKS_PAGE_SIZE,
  TasksDataTable,
} from "@/client/components/tasks-data-table";
import { createColumns } from "@/client/components/tasks-data-table/columns";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { useTrashTask } from "@/client/hooks/use-trash-task";
import { captureClientEvent } from "@/client/lib/capture-client-event";
import { getTrashTerminology } from "@/client/lib/trash-terminology";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import {
  isTaskId,
  type Project,
  type Task,
  type TaskId,
} from "@instrument-org/workspace/client";
import { StopCircleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const tasksSearchSchema = z.object({
  filter: z.enum(["all", "active", "pinned"]).optional().default("all"),
  page: z.coerce.number().int().positive().optional().default(1),
});

export const Route = createFileRoute("/_app/tasks/")({
  component: RouteComponent,
  head: () => {
    return {
      meta: [{ title: "Your Tasks" }],
    };
  },
  staticData: { tabIcon: "table-properties" },
  validateSearch: tasksSearchSchema,
});

function RouteComponent() {
  const { addTab } = useTabActions();
  const router = useRouter();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [deleteSelectedDialogOpen, setDeleteSelectedDialogOpen] =
    useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<null | Task>(null);
  // Deferred so `TaskSettingsDialog` stays mounted (and its close animation
  // can play) for a moment after `taskToEdit` clears to null, instead of
  // unmounting the instant the dialog starts closing.
  const {
    content: taskSettingsTask,
    onExitComplete: taskSettingsExitComplete,
  } = useDeferredModalState(taskToEdit);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isSingleDeleting, setIsSingleDeleting] = useState(false);
  const filterTab = search.filter;
  const trashTerminology = getTrashTerminology();

  const { data: tasksData, isLoading } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions({
      input: { direction: "desc", sortBy: "updatedAt" },
    }),
  );

  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData?.tasks]);

  const taskIds = useMemo(() => tasks.map((p) => p.id), [tasks]);

  const { data: agentStatuses } = useQuery({
    ...rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: taskIds },
    }),
  });

  const { data: pinnedTaskIds } = useQuery(
    rpcClient.workspace.pin.live.listTaskIds.experimental_liveOptions(),
  );

  const { data: projectsList } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const projectsMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projectsList ?? []) {
      map.set(project.id, project);
    }
    return map;
  }, [projectsList]);

  const pinnedTaskIdSet = useMemo(
    () => new Set<TaskId>(pinnedTaskIds),
    [pinnedTaskIds],
  );

  const activeTaskIds = useMemo(() => {
    if (!agentStatuses) {
      return new Set<TaskId>();
    }
    return new Set<TaskId>(
      agentStatuses
        .filter((state) => state.sessionActors.length > 0)
        .map((state) => state.taskId)
        .filter((id) => isTaskId(id)),
    );
  }, [agentStatuses]);

  const filteredTasks = useMemo(() => {
    switch (filterTab) {
      case "active": {
        return tasks.filter((p) => activeTaskIds.has(p.id));
      }
      case "pinned": {
        return tasks.filter((p) => pinnedTaskIdSet.has(p.id));
      }
      default: {
        return tasks;
      }
    }
  }, [activeTaskIds, pinnedTaskIdSet, filterTab, tasks]);

  const selectedTasks = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((id) => {
        return tasks.find((p) => p.id === id);
      })
      .filter((p): p is Task => p !== undefined);
  }, [tasks, rowSelection]);

  const hasRunningAgents = useMemo(() => {
    if (!agentStatuses || selectedTasks.length === 0) {
      return false;
    }
    const selectedTaskIdSet = new Set<TaskId>(selectedTasks.map((p) => p.id));
    return agentStatuses.some(
      (state) =>
        isTaskId(state.taskId) &&
        selectedTaskIdSet.has(state.taskId) &&
        state.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
    );
  }, [agentStatuses, selectedTasks]);

  const stopSessionMutation = useMutation(
    rpcClient.workspace.session.stop.mutationOptions(),
  );

  const { trashTask } = useTrashTask({ navigateOnDelete: false });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const importTaskMutation = useMutation(
    rpcClient.workspace.task.import.mutationOptions(),
  );

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== "string") {
          toast.error("Failed to read file");
          return;
        }
        const base64 = dataUrl.split(",")[1] ?? "";

        importTaskMutation.mutate(
          { zipFileData: base64 },
          {
            onError: (error) => {
              toast.error("Failed to import task", {
                description: error.message,
              });
            },
            onSuccess: (data) => {
              toast.success("Task imported successfully");
              void router.navigate({
                params: { id: data.id },
                to: "/tasks/$id",
              });
            },
          },
        );
      });
      reader.readAsDataURL(file);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [importTaskMutation, router],
  );

  const handleStop = useCallback(
    (id: TaskId) => {
      stopSessionMutation.mutate(
        { id },
        {
          onError: () => {
            toast.error("Failed to stop session");
          },
        },
      );
    },
    [stopSessionMutation],
  );

  const handleStopSelected = async () => {
    const taskIdsToStop = selectedTasks.map((p) => p.id);

    let successCount = 0;
    for (const id of taskIdsToStop) {
      try {
        await stopSessionMutation.mutateAsync({ id });
        successCount++;
      } catch {
        toast.error(`Failed to stop session for ${id}`);
      }
    }

    if (successCount > 0) {
      toast.success(
        `Stopped ${successCount} ${successCount === 1 ? "session" : "sessions"}`,
      );
      captureClientEvent("task.bulk_stopped", {
        task_count: successCount,
      });
    }
  };

  const handleDelete = useCallback(
    (id: TaskId) => {
      const task = tasks.find((p) => p.id === id);
      if (task) {
        openDeleteTask(task, {
          onDeleteEnd: () => {
            setIsSingleDeleting(false);
          },
          onDeleteStart: () => {
            setIsSingleDeleting(true);
          },
        });
      }
    },
    [tasks],
  );

  const handleDeleteSelected = () => {
    setDeleteSelectedDialogOpen(true);
  };

  const confirmDeleteSelected = async (tasksToDelete: Task[]) => {
    setIsBulkDeleting(true);
    let successCount = 0;
    let hasError = false;

    try {
      for (const task of tasksToDelete) {
        try {
          await trashTask(task.id);
          successCount++;
        } catch {
          toast.error(`Failed to delete task ${task.title}`);
          hasError = true;
        }
      }

      if (successCount > 0) {
        toast.success(
          `Moved ${successCount} ${successCount === 1 ? "task" : "tasks"} to ${trashTerminology}`,
        );
        captureClientEvent("task.bulk_deleted", {
          task_count: successCount,
        });
      }
      setRowSelection({});

      if (hasError) {
        throw new Error("Some tasks failed to delete");
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleOpenInNewTab = useCallback(
    (id: TaskId) => {
      void addTab(
        {
          params: { id },
          to: "/tasks/$id",
        },
        { select: true },
      );
    },
    [addTab],
  );

  const handleSettings = useCallback(
    (id: TaskId) => {
      const task = tasks.find((p) => p.id === id);
      if (task) {
        setTaskToEdit(task);
        setSettingsDialogOpen(true);
      }
    },
    [tasks],
  );

  const columns = useMemo(
    () =>
      createColumns({
        onDelete: handleDelete,
        onOpenInNewTab: handleOpenInNewTab,
        onSettings: handleSettings,
        onStop: handleStop,
        pinnedTaskIds: pinnedTaskIdSet,
        projects: projectsMap,
      }),
    [
      pinnedTaskIdSet,
      projectsMap,
      handleDelete,
      handleOpenInNewTab,
      handleSettings,
      handleStop,
    ],
  );

  useEffect(() => {
    // Ensures we stay on a valid page when filtered tasks change
    const maxPage = Math.max(
      1,
      Math.ceil(filteredTasks.length / TASKS_PAGE_SIZE),
    );

    if (search.page > maxPage) {
      void navigate({ replace: true, search: { ...search, page: maxPage } });
    }
  }, [filteredTasks.length, navigate, search]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1">
      <div>
        <div className="mx-auto px-4 pt-10 sm:px-6 lg:px-8 lg:pt-20 lg:pb-4">
          <div className="flex flex-col items-center gap-y-4 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              Your Tasks
            </h1>
            <CommandMenuCTA />
          </div>
        </div>
      </div>

      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-y-4">
          <div className="flex items-center justify-between">
            <Tabs
              onValueChange={(v) => {
                const filter = tasksSearchSchema.parse({ filter: v });
                void navigate({ search: filter });
              }}
              value={filterTab}
            >
              <TabsList>
                <TabsTrigger value="all">
                  All
                  <Badge
                    className="ml-2 px-1.5"
                    variant={filterTab === "all" ? "default" : "secondary"}
                  >
                    {tasks.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="active">
                  Active
                  <Badge
                    className="ml-2 px-1.5"
                    variant={filterTab === "active" ? "default" : "secondary"}
                  >
                    {activeTaskIds.size}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="pinned">
                  Pinned
                  <Badge
                    className="ml-2 px-1.5"
                    variant={filterTab === "pinned" ? "default" : "secondary"}
                  >
                    {pinnedTaskIdSet.size}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-x-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    disabled={importTaskMutation.isPending}
                    onClick={handleImport}
                    size="sm"
                    variant="secondary"
                  >
                    Import task
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Select a zip file exported from {APP_NAME} containing a
                  .instrument/{TASK_SETTINGS_FILE_NAME} file
                </TooltipContent>
              </Tooltip>
              <input
                accept=".zip"
                className="hidden"
                onChange={handleFileSelect}
                ref={fileInputRef}
                type="file"
              />
              <Button asChild size="sm">
                <InternalLink to="/new-tab">New task</InternalLink>
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : isBulkDeleting || isSingleDeleting ? (
            <div className="flex flex-col items-center justify-center gap-y-4 rounded-md border bg-muted/20 py-12">
              <div className="text-sm text-muted-foreground">
                {isBulkDeleting
                  ? `Deleting ${selectedTasks.length} ${selectedTasks.length === 1 ? "task" : "tasks"}...`
                  : "Deleting task..."}
              </div>
            </div>
          ) : (
            <TasksDataTable
              bulkActions={
                <>
                  <Button
                    disabled={!hasRunningAgents}
                    onClick={handleStopSelected}
                    size="sm"
                    variant="outline"
                  >
                    <StopCircleIcon className="size-4" />
                    Stop
                  </Button>
                  <Button
                    disabled={selectedTasks.length === 0}
                    onClick={handleDeleteSelected}
                    size="sm"
                    variant="outline"
                  >
                    <TrashIcon className="size-4" />
                    Delete
                  </Button>
                </>
              }
              columns={columns}
              data={filteredTasks}
              onPageChange={(page) => {
                void navigate({ replace: true, search: { ...search, page } });
              }}
              onRowSelectionChange={setRowSelection}
              page={search.page}
              rowSelection={rowSelection}
            />
          )}
        </div>
      </div>

      <DeleteWithProgressDialog
        description={`${selectedTasks.length === 1 ? "This task" : "These tasks"} will be moved to your system ${trashTerminology}.`}
        items={selectedTasks}
        onDelete={confirmDeleteSelected}
        onOpenChange={setDeleteSelectedDialogOpen}
        open={deleteSelectedDialogOpen}
        title={`Move ${selectedTasks.length} ${selectedTasks.length === 1 ? "task" : "tasks"} to ${trashTerminology}?`}
      />

      {taskSettingsTask && (
        <TaskSettingsDialog
          onExitComplete={taskSettingsExitComplete}
          onOpenChange={(open) => {
            setSettingsDialogOpen(open);
            if (!open) {
              setTaskToEdit(null);
            }
          }}
          open={settingsDialogOpen}
          task={taskSettingsTask}
        />
      )}
    </div>
  );
}
