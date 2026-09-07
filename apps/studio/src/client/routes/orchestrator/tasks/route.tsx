import {
  TASKS_COLUMN_MAX,
  TASKS_COLUMN_MIN,
  tasksColumnWidthAtom,
} from "@/client/atoms/orchestrator";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import {
  TaskList,
  type TaskListItem,
} from "@/client/components/orchestrator/task-list";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { Spinner } from "@/client/components/ui/spinner";
import { hasLiveAgent } from "@/client/lib/agent-status";
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
  const openId = childIds.find(
    (id) => location.pathname === `/orchestrator/tasks/${id}`,
  );
  const items: TaskListItem[] =
    children.data?.map((child) => ({
      ...(child.channel ? { channel: child.channel } : {}),
      id: child.id,
      line: child.standing.line,
      standing: child.standing.kind,
      title: child.title,
      updatedAt: child.updatedAt,
    })) ?? [];
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
  const list = children.data ? (
    <TaskList
      items={items}
      onOpen={(id) => {
        void navigate({ params: { id }, to: "/orchestrator/tasks/$id" });
      }}
      {...(openId ? { openId } : {})}
    />
  ) : (
    <div className="flex justify-center py-8">
      <Spinner className="size-5" />
    </div>
  );

  // With nothing open the list is the screen; opening one puts it in a column
  // beside the task, which is the only time its width has to be settled.
  if (!openId) {
    return <div className="h-full min-h-0">{list}</div>;
  }

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
        <div className="flex min-h-0 w-full flex-1 flex-col">{list}</div>
      </StudioSidebarRail>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
