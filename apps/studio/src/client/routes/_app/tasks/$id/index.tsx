import { releaseTaskDraft } from "@/client/atoms/prompt-value";
import { TaskSettingsDialog } from "@/client/components/task/settings-dialog";
import { TaskView } from "@/client/components/task/view";
import { useClearTaskIndicatorOnView } from "@/client/hooks/use-clear-task-indicator-on-view";
import { useIsTaskPageVisible } from "@/client/hooks/use-task-page-visible";
import { useTaskRouteSync } from "@/client/hooks/use-task-route-sync";
import { rpcClient } from "@/client/rpc/client";
import {
  StoreId,
  type Task,
  TaskIdSchema,
  TaskPane,
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
  selectedSessionId: StoreId.SessionSchema.optional(),
  showSettings: z.boolean().optional(),
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
  return task?.title ?? "Not found";
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
    // Garbage collect task atoms. The draft is flushed on the way out, so
    // walking away mid-sentence still lands the last edit before the in-memory
    // copy that would have been written goes away.
    releaseTaskDraft(params.id);
  },
  beforeLoad: async ({ context, params, preload, search }) => {
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

    // Not on preload: this one writes. A task with no model yet gets the
    // current default persisted into its state, so running it from a hover
    // would pin whatever the default happened to be that moment onto a task
    // the user never opened. Everything above is a read, which is what makes
    // hovering worth anything.
    if (!preload) {
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
    }

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
      selectedSessionId
        ? seedLiveQuery({
            queryClient,
            queryKey:
              rpcClient.workspace.message.live.list.experimental_liveKey({
                input: { id, sessionId: selectedSessionId },
              }),
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
  const { selectedSessionId, showSettings } = Route.useSearch();
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

  // Two holds on the task's browser, and the subscriptions themselves are the
  // whole payload: each yields nothing worth reading, so both results go unused
  // on purpose.
  //
  // The retained hold lasts as long as this page is mounted, which is what tells
  // the server the user still has this task open and can come back to whatever
  // is loaded in it. The visible hold lasts only while the page is on screen.
  // Every task page stays mounted while backgrounded, so mount alone cannot
  // distinguish the two and the server needs both to pick which clock a browser
  // is on.
  const isVisible = useIsTaskPageVisible();
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id, level: "retained" },
    }),
  );
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: isVisible ? { id, level: "visible" } : skipToken,
    }),
  );

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
        attachedFolders={taskState.attachedFolders}
        pane={taskState.pane ?? TaskPane.EMPTY}
        promptDraft={taskState.promptDraft ?? ""}
        selectedModelURI={taskState.selectedModelURI}
        selectedSessionId={selectedSessionId}
        showTutorial={taskState.showTutorial}
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
