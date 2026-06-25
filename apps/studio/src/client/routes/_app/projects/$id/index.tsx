import { ProjectFolders } from "@/client/components/project/project-folders";
import { ProjectInstructions } from "@/client/components/project/project-instructions";
import { ProjectTaskRow } from "@/client/components/project/project-task-row";
import { PromptInput } from "@/client/components/prompt-input";
import { TaskDeleteDialog } from "@/client/components/task/delete-dialog";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useMediaQuery } from "@/client/hooks/use-media-query";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import {
  openDeleteProject,
  openEditProject,
} from "@/client/lib/open-create-project";
import { rpcClient } from "@/client/rpc/client";
import { createIconMeta } from "@/shared/tabs";
import { APP_NAME } from "@instrument-org/shared";
import { ProjectIdSchema, type Task } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  CaretRightIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/projects/$id/")({
  params: {
    parse: (rawParams) => ({ id: ProjectIdSchema.parse(rawParams.id) }),
  },
  component: RouteComponent,
  head: async ({ params }) => {
    const projectResult = await safe(
      rpcClient.workspace.project.byId.call({ id: params.id }),
    );

    return {
      meta: [
        { title: projectResult.data?.name ?? "Project" },
        createIconMeta("project"),
      ],
    };
  },
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const promptInputRef = useRef<{ clear: () => void; focus: () => void }>(null);

  // Below this width the right-hand details panel can't sit beside the main
  // column, so it folds into a collapsible section above the task list. This
  // route fills its own tab WebContentsView (the sidebar is a separate view),
  // so the viewport width is the page width and a plain media query is accurate.
  const isWide = useMediaQuery("(min-width: 1024px)");

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

  // keepPreviousData holds the last snapshot while the live query re-subscribes
  // (its data otherwise blinks to undefined during the mutation storm when a task
  // or the project is deleted, flashing the empty state).
  const { data: tasksData } = useQuery(
    rpcClient.workspace.task.live.list.experimental_liveOptions({
      input: { direction: "desc", sortBy: "updatedAt" },
      placeholderData: keepPreviousData,
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

  const orderedMemberTasks = useMemo(() => {
    const pinned = memberTasks.filter((task) => pinnedTaskIdSet.has(task.id));
    const rest = memberTasks.filter((task) => !pinnedTaskIdSet.has(task.id));
    return [...pinned, ...rest];
  }, [memberTasks, pinnedTaskIdSet]);

  const createTaskMutation = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );

  // Project instructions/details are file-backed; nothing publishes an update
  // for edits made to those files outside the app. The live.list query is a
  // perpetual subscription (always "fetching"), so refetchOnWindowFocus is a
  // no-op; instead nudge the existing subscription to re-read disk on focus.
  // TanStack's focusManager only watches visibilitychange, which Electron does
  // not fire when the OS window regains focus (the view is never marked hidden),
  // so we listen for window focus too and re-read disk.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void safe(rpcClient.workspace.project.refresh.call());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const hadProjectRef = useRef(false);
  const leftRef = useRef(false);
  useEffect(() => {
    if (projectData) {
      hadProjectRef.current = true;
      return;
    }
    if (hadProjectRef.current && !projectLoading && !leftRef.current) {
      leftRef.current = true;
      void navigate({ to: "/new-tab" });
    }
  }, [projectData, projectLoading, navigate]);

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

  const details = (
    <>
      <ProjectInstructions
        instructions={projectData.instructions}
        key={projectData.id}
        projectId={projectData.id}
      />
      <ProjectFolders
        folders={projectData.folders}
        projectId={projectData.id}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-y-6 px-6 py-10">
          <div className="flex items-start justify-between gap-x-4">
            <div className="flex min-w-0 flex-col gap-y-1">
              <h1 className="font-serif text-2xl font-medium">
                {projectData.name}
              </h1>
              {projectData.description && (
                <p className="text-sm text-muted-foreground">
                  {projectData.description}
                </p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <DotsThreeOutlineVerticalIcon
                    className="size-4"
                    weight="fill"
                  />
                  <span className="sr-only">Project actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    openEditProject(id);
                  }}
                >
                  <PencilSimpleLineIcon className="text-muted-foreground" />
                  <span>Edit project</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    openDeleteProject(id);
                  }}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  <span>Delete project</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <PromptInput
            allowOpenInNewTab
            atomKey={`$$project:${id}$$`}
            autoFocus
            autoResizeMaxHeight={240}
            isLoading={createTaskMutation.isPending}
            modelURI={selectedModelURI}
            onModelChange={setSelectedModelURI}
            onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
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
                    if (openInNewTab) {
                      void addTab(
                        {
                          params: { id: taskId },
                          search: { selectedSessionId: sessionId },
                          to: "/tasks/$id",
                        },
                        { select: false },
                      );
                    } else {
                      void navigate({
                        params: { id: taskId },
                        search: { selectedSessionId: sessionId },
                        to: "/tasks/$id",
                      });
                    }
                  },
                },
              );
            }}
            placeholder={`Talk to ${APP_NAME}`}
            ref={promptInputRef}
          />

          {!isWide && (
            <Collapsible className="flex flex-col">
              <CollapsibleTrigger className="group/details flex items-center gap-x-1 px-3 py-1 text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground">
                <span>Project details</span>
                <CaretRightIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/details:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent
                animated
                className="flex flex-col gap-y-2 pt-2"
              >
                {details}
              </CollapsibleContent>
            </Collapsible>
          )}

          <div className="flex flex-col gap-y-1">
            <div className="px-3 py-1 text-xs font-medium text-muted-foreground/60">
              Tasks
            </div>
            {memberTasks.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                No tasks in this project yet. Start one above.
              </p>
            ) : (
              orderedMemberTasks.map((task) => (
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

      {isWide && (
        <aside className="flex w-120 shrink-0 flex-col gap-y-2 overflow-y-auto p-4">
          {details}
        </aside>
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
