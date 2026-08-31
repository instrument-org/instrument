import { openDeleteTask } from "@/client/atoms/delete-task-modal";
import { openEditProject } from "@/client/atoms/project-modal";
import { ProjectDevDiskMenuItems } from "@/client/components/dev-disk-menu-items";
import { FileDropRegion } from "@/client/components/file-drop-region";
import { DeleteProjectDialog } from "@/client/components/project/delete-project-dialog";
import { ProjectFolders } from "@/client/components/project/project-folders";
import { ProjectInstructions } from "@/client/components/project/project-instructions";
import { ProjectTaskRow } from "@/client/components/project/project-task-row";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import { Spinner } from "@/client/components/ui/spinner";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ProjectIdSchema } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/projects/$id/")({
  params: {
    parse: (rawParams) => ({ id: ProjectIdSchema.parse(rawParams.id) }),
  },
  loader: async ({ params }) => {
    const [error, , isDefined] = await safe(
      rpcClient.workspace.project.byId.call({ id: params.id }),
    );
    if (error && isDefined && error.code === "NOT_FOUND") {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ replace: true, to: "/new-tab" });
    }
    // Allow route to load on transient/workspace-not-ready errors
  },
  component: RouteComponent,
  staticData: { tabIcon: "project" },
  head: async ({ params }) => {
    const projectResult = await safe(
      rpcClient.workspace.project.byId.call({ id: params.id }),
    );

    return {
      meta: [{ title: projectResult.data?.name ?? "Project" }],
    };
  },
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { addTab } = useTabActions();
  const tabId = useTabId();
  const [selectedModelURI, setSelectedModelURI, saveSelectedModelURI] =
    useDefaultModelURI();
  const promptInputRef = useRef<PromptInputRef>(null);

  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  const {
    data: projects,
    error: projectError,
    isLoading: projectLoading,
  } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions({
      placeholderData: keepPreviousData,
    }),
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

  const leftRef = useRef(false);
  useEffect(() => {
    if (projects !== undefined && !projectData && !leftRef.current) {
      leftRef.current = true;
      void navigate({ to: "/new-tab" });
    }
  }, [projects, projectData, navigate]);

  if (projectLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{projectError.message}</p>
      </div>
    );
  }

  if (!projectData) {
    return null;
  }

  return (
    <FileDropRegion className="h-full overflow-y-auto">
      {/*
        One column of content with the details panel beside it once there's room
        for both at full width. Only the panel is placed explicitly; the heading,
        composer and task list auto-flow down column one, which is also the order
        they read in when the grid collapses to a single column, with the panel
        tucked under the heading. Narrow, the panel is a disclosure so it stays
        collapsed by default and keeps the composer near the top; wide, the same
        rule that gives it its own column forces it open and drops the toggle.

        The panel spans column one's three rows, which takes two rules to keep
        from deforming that column. `items-start` stops a short item from
        stretching to a tall row. The explicit row tracks stop the rows from
        growing at all: grid distributes a spanning item's excess height across
        the tracks it crosses, so every folder added to the panel pushed the
        heading, composer and task list further apart. An item crossing a
        flexible track is excluded from intrinsic track sizing, so the `1fr`
        sends that excess to the last row, below the task list, where nothing
        moves.
      */}
      <div className="mx-auto grid max-w-2xl grid-cols-1 items-start gap-y-6 px-6 py-10 @6xl/app-content:max-w-none @6xl/app-content:grid-cols-[minmax(0,42rem)_30rem] @6xl/app-content:grid-rows-[auto_auto_1fr] @6xl/app-content:justify-center @6xl/app-content:gap-x-8">
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
              <ProjectDevDiskMenuItems
                menuComponents={dropdownMenuComponents}
                projectId={id}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setDeleteProjectOpen(true);
                }}
                variant="destructive"
              >
                <TrashIcon className="size-4" />
                <span>Delete project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <details className="group/details details-animated @6xl/app-content:sticky @6xl/app-content:top-10 @6xl/app-content:col-start-2 @6xl/app-content:row-span-3 @6xl/app-content:row-start-1 @6xl/app-content:details-always-open">
          <summary className="flex list-none items-center gap-x-1 py-1 text-xs font-medium text-muted-foreground/60 select-none hover:text-muted-foreground @6xl/app-content:hidden">
            <span>Project details</span>
            <CaretRightIcon className="size-3 shrink-0 transition-transform group-open/details:rotate-90" />
          </summary>
          <div className="flex flex-col gap-y-2 pt-2 @6xl/app-content:pt-0">
            <ProjectInstructions
              instructions={projectData.instructions}
              key={projectData.id}
              projectId={projectData.id}
            />
            <ProjectFolders
              folders={projectData.folders}
              projectId={projectData.id}
            />
          </div>
        </details>

        <PromptInput
          allowOpenInNewTab
          autoFocus
          autoResizeMaxHeight={240}
          draftKey={{ scope: "compose", tabId }}
          isLoading={createTaskMutation.isPending}
          modelURI={selectedModelURI}
          onModelChange={setSelectedModelURI}
          onSubmit={({ files, folders, modelURI, openInNewTab, prompt }) => {
            saveSelectedModelURI(modelURI);
            createTaskMutation.mutate(
              { files, folders, modelURI, projectId: id, prompt },
              {
                onError: (error) => {
                  toast.error("Failed to start task", {
                    description: error.message,
                  });
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

        <div className="flex flex-col gap-y-1">
          <div className="px-3 py-1 text-xs font-medium text-muted-foreground/60">
            Tasks
          </div>
          {memberTasks.length === 0 ? (
            <p className="px-3 py-1 text-sm text-muted-foreground">
              No tasks in this project yet.
            </p>
          ) : (
            orderedMemberTasks.map((task) => (
              <ProjectTaskRow
                isPinned={pinnedTaskIdSet.has(task.id)}
                key={task.id}
                onDelete={(t) => {
                  openDeleteTask(t);
                }}
                onOpenInNewTab={(t) => {
                  void addTab({
                    params: { id: t.id },
                    to: "/tasks/$id",
                  });
                }}
                task={task}
              />
            ))
          )}
        </div>
      </div>

      <DeleteProjectDialog
        onOpenChange={setDeleteProjectOpen}
        open={deleteProjectOpen}
        projectId={projectData.id}
        projectName={projectData.name}
      />
    </FileDropRegion>
  );
}
