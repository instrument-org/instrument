import { ProjectFolders } from "@/client/components/project/project-folders";
import { ProjectInstructions } from "@/client/components/project/project-instructions";
import { ProjectTaskRow } from "@/client/components/project/project-task-row";
import { PromptInput } from "@/client/components/prompt-input";
import { TaskDeleteDialog } from "@/client/components/task/delete-dialog";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient } from "@/client/rpc/client";
import { createIconMeta } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { ProjectIdSchema, type Task } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/projects/$id/")({
  params: {
    parse: (rawParams) => ({ id: ProjectIdSchema.parse(rawParams.id) }),
  },
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Project" }, createIconMeta("project")],
  }),
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

  const [taskToEdit, setTaskToEdit] = useState<null | Task>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<null | Task>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: projects, isLoading: projectLoading } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );
  const projectData = useMemo(
    () => projects?.find((project) => project.id === id),
    [projects, id],
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
    () => new Set(pinnedTaskIds),
    [pinnedTaskIds],
  );

  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );

  if (projectLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!projectData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-y-6 px-6 py-10">
          <div className="flex flex-col gap-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {projectData.name}
            </h1>
            {projectData.description && (
              <p className="text-sm text-muted-foreground">
                {projectData.description}
              </p>
            )}
          </div>

          <PromptInput
            atomKey={`$$project:${id}$$`}
            autoResizeMaxHeight={240}
            isLoading={createTaskMutation.isPending}
            modelURI={selectedModelURI}
            onModelChange={setSelectedModelURI}
            onSubmit={({ files, folders, modelURI, prompt }) => {
              saveSelectedModelURI(modelURI);
              createTaskMutation.mutate(
                { files, folders, modelURI, projectId: id, prompt },
                {
                  onError: (error) => {
                    toast.error(
                      `There was an error starting your task: ${error.message}`,
                    );
                  },
                  onSuccess: ({ id: taskId, sessionId }) => {
                    promptInputRef.current?.clear();
                    void navigate({
                      params: { id: taskId },
                      search: { selectedSessionId: sessionId },
                      to: "/tasks/$id",
                    });
                  },
                },
              );
            }}
            placeholder={`Talk to ${APP_NAME}`}
            ref={promptInputRef}
          />

          <div className="flex flex-col gap-y-1">
            <div className="px-3 py-1 text-xs font-medium text-muted-foreground/60">
              Tasks
            </div>
            {memberTasks.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                No tasks in this project yet. Start one above.
              </p>
            ) : (
              memberTasks.map((task) => (
                <ProjectTaskRow
                  isPinned={pinnedTaskIdSet.has(task.id)}
                  key={task.id}
                  onDelete={(t) => {
                    setTaskToDelete(t);
                    setDeleteDialogOpen(true);
                  }}
                  onRename={(t) => {
                    setTaskToEdit(t);
                    setSettingsDialogOpen(true);
                  }}
                  task={task}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-y-6 overflow-y-auto border-l p-6">
        <ProjectInstructions
          instructions={projectData.instructions}
          key={projectData.id}
          projectId={projectData.id}
        />
        <ProjectFolders
          folders={projectData.folders}
          projectId={projectData.id}
        />
      </aside>

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
    </div>
  );
}
