import {
  TASKS_COLUMN_MAX,
  TASKS_COLUMN_MIN,
  tasksColumnWidthAtom,
} from "@/client/atoms/orchestrator";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RelativeTime } from "@/client/components/relative-time";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { Spinner } from "@/client/components/ui/spinner";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import ms from "ms";

const REFRESH_MS = ms("2 seconds");

/** The list column never collapses: its floor is its collapse point. */
const COLUMN_BOUNDS: RailBounds = {
  collapse: TASKS_COLUMN_MIN,
  initial: 288,
  max: TASKS_COLUMN_MAX,
  min: TASKS_COLUMN_MIN,
};

/**
 * The Tasks screen: the tasks behind the conversation down a column, one row
 * each with its title and where it stands, and the one that is open beside
 * them. The escape hatch: the orchestrator is meant to be the only thing the
 * user talks to, and this is how they look over its shoulder.
 */
export const Route = createFileRoute("/orchestrator/tasks")({
  component: TasksLayout,
});

function TasksLayout() {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const childIds = children.data?.map((child) => child.id) ?? [];
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: childIds },
      refetchInterval: REFRESH_MS,
    }),
  );
  const running = new Set<TaskId>(
    status.data?.filter(hasLiveAgent).map((entry) => entry.taskId) ?? [],
  );
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const stepOf = (id: TaskId) =>
    activity.data?.running.find((entry) => entry.taskId === id)?.step;
  // The list is what is on screen only while no task is open beside it.
  useOnScreen(
    location.pathname === "/orchestrator/tasks" && children.data
      ? {
          screen: "tasks",
          tasks: children.data.map((child) => ({
            id: child.id,
            status: running.has(child.id) ? "working" : "done",
            ...(stepOf(child.id) ? { step: stepOf(child.id) } : {}),
            title: child.title,
          })),
        }
      : null,
  );

  return (
    <div className="flex h-full min-h-0">
      <StudioSidebarRail
        bounds={COLUMN_BOUNDS}
        isOpen
        label="Resize the task list"
        onCollapse={() => {
          // The list is the screen; it has no away to slide to.
        }}
        panelClassName="bg-background"
        widthAtom={tasksColumnWidthAtom}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <h1 className="px-4 pt-3 pb-2 text-lg font-semibold">Tasks</h1>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {children.data ? (
              children.data.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">
                  Ask for something and a task appears here.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {children.data.map((child) => {
                    const isOpen =
                      location.pathname === `/orchestrator/tasks/${child.id}`;
                    const isRunning = running.has(child.id);
                    return (
                      <li key={child.id}>
                        <button
                          className={cn(
                            "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-foreground/5",
                            isOpen && "bg-foreground/8",
                          )}
                          onClick={() => {
                            void navigate({
                              params: { id: child.id },
                              to: "/orchestrator/tasks/$id",
                            });
                          }}
                          type="button"
                        >
                          <span className="w-full truncate text-sm">
                            {child.title}
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {isRunning ? (
                              <>
                                <Spinner className="size-3" />
                                Working
                              </>
                            ) : (
                              <>
                                Done ·{" "}
                                <RelativeTime
                                  date={child.updatedAt}
                                  tooltip={false}
                                />
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <div className="flex justify-center py-8">
                <Spinner className="size-5" />
              </div>
            )}
          </div>
        </div>
      </StudioSidebarRail>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
