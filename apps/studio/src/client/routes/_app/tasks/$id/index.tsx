import { taskDraftFamily } from "@/client/atoms/prompt-value";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { TaskSidebarModeSchema } from "@/client/components/task/sidebar";
import { TaskView } from "@/client/components/task/view";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useAutoOpenBrowserArtifact } from "@/client/hooks/use-auto-open-browser-artifact";
import { useAutoOpenOutputArtifact } from "@/client/hooks/use-auto-open-output-artifact";
import { useClearTaskIndicatorOnView } from "@/client/hooks/use-clear-task-indicator-on-view";
import { useTaskRouteSync } from "@/client/hooks/use-task-route-sync";
import { rpcClient } from "@/client/rpc/client";
import { artifactPanelSchema } from "@/client/schemas/artifact-panel";
import {
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  CancelledError,
  type QueryClient,
  type QueryKey,
  skipToken,
  useQuery,
} from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";

const taskSearchSchema = z.object({
  artifactPanel: artifactPanelSchema.optional(),
  selectedSessionId: StoreId.SessionSchema.optional(),
  showSettings: z.boolean().optional(),
  sidebar: TaskSidebarModeSchema.optional(),
});

function hasActiveObservers(queryClient: QueryClient, queryKey: QueryKey) {
  const query = queryClient.getQueryCache().find({ queryKey });
  return (query?.getObserversCount() ?? 0) > 0;
}

// Live queries subscribe on mount and only receive their first snapshot after
// the subscription starts, so a freshly-navigated task view would otherwise
// mount against an empty or stale cache. Seeding the live key from a plain
// read gives the mount a current snapshot (the same pattern beforeLoad uses
// for session.list). The seed must overwrite existing unmounted entries: when
// a live query unmounts, TanStack cancels its fetch with `revert: true`,
// rolling the cached data back to the snapshot from when the subscription
// began — often far staler than what was last on screen. Mounted queries
// (active observers) are skipped instead: they keep themselves fresh, and a
// seed would race their live chunks.
async function seedLiveQuery<T>({
  queryClient,
  queryKey,
  read,
}: {
  queryClient: QueryClient;
  queryKey: QueryKey;
  read: () => Promise<T>;
}) {
  if (hasActiveObservers(queryClient, queryKey)) {
    return;
  }
  const [error, data] = await safe(read());
  if (!error && !hasActiveObservers(queryClient, queryKey)) {
    queryClient.setQueryData(queryKey, data);
  }
}

function title(task?: Task) {
  return task?.title ?? "Not Found";
}

/* eslint-disable perfectionist/sort-objects */
export const Route = createFileRoute("/_app/tasks/$id/")({
  // Must come before component for type inference
  params: {
    parse: (rawParams) => {
      return {
        id: TaskIdSchema.parse(rawParams.id),
      };
    },
  },
  loaderDeps: ({ search }) => ({
    selectedSessionId: search.selectedSessionId,
  }),
  onLeave: ({ params }) => {
    // Garbage collect task atoms
    taskDraftFamily.remove(params.id);
  },
  beforeLoad: async ({ context, params, search }) => {
    const needsSessionDefault = !search.selectedSessionId;

    const [sessionError, sessions, isDefined] = await safe(
      rpcClient.workspace.session.list.call({
        id: params.id,
      }),
    );

    if (sessionError) {
      if (isDefined && sessionError.code === "NOT_FOUND") {
        // oxlint-disable-next-line typescript/only-throw-error
        throw notFound();
      }
      // Allow route to load if not defined or not a NOT_FOUND error
      return;
    }

    context.queryClient.setQueryData(
      rpcClient.workspace.session.live.list.experimental_liveKey({
        input: { id: params.id },
      }),
      sessions,
    );

    void rpcClient.preferences.ensureTaskDefaultModelURI
      .call({ id: params.id })
      .then((result) => {
        if (!result.modelURI) {
          return;
        }

        void context.queryClient.invalidateQueries({
          queryKey:
            rpcClient.workspace.task.state.live.get.experimental_liveKey({
              input: { id: params.id },
            }),
        });
      })
      .catch(() => {
        // The task page can still load with no selected model.
      });

    const newestSession = sessions.at(-1);

    if (needsSessionDefault && newestSession) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({
        params: { id: params.id },
        // Replace, not push: otherwise the sessionless entry stays in history
        // and back/forward lands on a task with no session (and no browser).
        replace: true,
        search: (prev) => ({
          ...prev,
          selectedSessionId: newestSession.id,
        }),
        to: "/tasks/$id",
      });
    }
  },
  // Warms everything the task view mounts with — including the transcript —
  // before the navigation commits, so hover preload makes task switches
  // instant and non-hover paths (command menu, back/forward) never mount
  // against an empty cache. Errors are swallowed here; the route component's
  // own queries surface them.
  loader: async ({ context: { queryClient }, deps, params }) => {
    const { id } = params;
    const { selectedSessionId } = deps;
    await Promise.all([
      seedLiveQuery({
        queryClient,
        queryKey: rpcClient.workspace.task.live.byId.experimental_liveKey({
          input: { id },
        }),
        read: () => rpcClient.workspace.task.byId.call({ id }),
      }),
      seedLiveQuery({
        queryClient,
        queryKey: rpcClient.workspace.task.state.live.get.experimental_liveKey({
          input: { id },
        }),
        read: () => rpcClient.workspace.task.state.get.call({ id }),
      }),
      seedLiveQuery({
        queryClient,
        queryKey: rpcClient.workspace.task.files.live.list.experimental_liveKey(
          { input: { taskId: id } },
        ),
        read: () => rpcClient.workspace.task.files.list.call({ taskId: id }),
      }),
      selectedSessionId
        ? seedLiveQuery({
            queryClient,
            queryKey:
              rpcClient.workspace.message.live.listWithParts.experimental_liveKey(
                { input: { id, sessionId: selectedSessionId } },
              ),
            read: () =>
              rpcClient.workspace.message.list.call({
                id,
                sessionId: selectedSessionId,
              }),
          })
        : undefined,
    ]);
  },
  component: RouteComponent,
  staticData: { tabTaskIdParam: "id" },
  head: async ({ params }) => {
    const taskResult = await safe(
      rpcClient.workspace.task.byId.call({
        id: params.id,
      }),
    );

    return {
      meta: [{ title: title(taskResult.data) }],
    };
  },
  validateSearch: taskSearchSchema,
});
/* eslint-enable perfectionist/sort-objects */

function RouteComponent() {
  const { id } = Route.useParams();
  const { artifactPanel, selectedSessionId, showSettings, sidebar } =
    Route.useSearch();
  const navigate = useNavigate();

  useClearTaskIndicatorOnView(id);

  const handleSettingsDialogChange = (open: boolean) => {
    void navigate({
      from: "/tasks/$id/",
      params: { id },
      replace: true,
      search: (prev) => ({ ...prev, showSettings: open || undefined }),
    });
  };

  const {
    data: task,
    error: taskError,
    isLoading: isTaskLoading,
  } = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id },
    }),
  );

  useTaskRouteSync(task);

  const {
    data: taskState,
    error: taskStateError,
    isLoading: isTaskStateLoading,
  } = useQuery(
    rpcClient.workspace.task.state.live.get.experimental_liveOptions({
      input: { id },
    }),
  );

  const { data: files } = useQuery(
    rpcClient.workspace.task.files.live.list.experimental_liveOptions({
      input: { taskId: id },
    }),
  );

  // Presence is scoped to the foreground tab, not to mount: every tab stays
  // mounted in the background, so gating on the active tab lets the server's
  // taskBrowser machine reap an unviewed task's browser after its grace period.
  const isActiveTab = useIsActiveTab();
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: isActiveTab ? { id } : skipToken,
    }),
  );

  // Focuses output artifacts produced by the active turn.
  useAutoOpenOutputArtifact({
    artifactPanel,
    id,
    selectedSessionId,
  });

  // Opens the browser panel when the agent starts browsing.
  useAutoOpenBrowserArtifact({
    id,
    selectedSessionId,
  });

  const isLoading = isTaskLoading || isTaskStateLoading;

  const error = taskError ?? taskStateError;

  if (isLoading) {
    return null;
  }

  if (error && !(error instanceof CancelledError)) {
    return <div>{error.message}</div>;
  }

  // Should never happen since both queries are required to load successfully
  if (!task || !taskState) {
    return null;
  }

  return (
    <>
      <TaskView
        artifactPanel={artifactPanel}
        attachedFolders={taskState.attachedFolders}
        files={files}
        selectedModelURI={taskState.selectedModelURI}
        selectedSessionId={selectedSessionId}
        showTutorial={taskState.showTutorial}
        sidebar={sidebar ?? "chat"}
        task={task}
      />

      <TaskSettingsDialog
        onOpenChange={handleSettingsDialogChange}
        open={showSettings ?? false}
        task={task}
      />
    </>
  );
}
