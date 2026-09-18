import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import {
  TaskList,
  type TaskListItem,
} from "@/client/components/orchestrator/task-list";
import { ThreadTaskList } from "@/client/components/orchestrator/thread-task-list";
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
import { z } from "zod";

const REFRESH_MS = ms("2 seconds");

/**
 * The Tasks screen: the tasks behind the conversation as a list, one row each
 * with its title and where it stands, and the one that is open in its place.
 * The escape hatch: the orchestrator is meant to be the only thing the user
 * talks to, and this is how they look over its shoulder. Given a thread, the
 * list is that thread's tasks alone, in the pane beside it.
 */
export const Route = createFileRoute("/orchestrator/tasks")({
  component: TasksLayout,
  validateSearch: z.object({
    /** The thread whose tasks alone are listed, by session id; every task otherwise. */
    thread: z.string().optional(),
  }),
});

function TasksLayout() {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const { thread } = Route.useSearch();
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
  const listed =
    thread === undefined
      ? children.data
      : children.data?.filter((child) => child.threadId === thread);
  const items: TaskListItem[] =
    listed?.map((child) => ({
      ...(child.threadTitle ? { threadTitle: child.threadTitle } : {}),
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
  const open = (id: TaskId) => {
    void navigate({ params: { id }, to: "/orchestrator/tasks/$id" });
  };
  const list = listed ? (
    thread === undefined ? (
      <TaskList items={items} onOpen={open} {...(openId ? { openId } : {})} />
    ) : (
      <ThreadTaskList items={items} onOpen={open} />
    )
  ) : (
    <div className="flex justify-center py-8">
      <Spinner className="size-5" />
    </div>
  );

  // With nothing open the list is the screen. An open task has the screen to
  // itself: the user came to look at that task, and the list is one crumb up
  // in the tab's location row.
  if (!openId) {
    return <div className="h-full min-h-0">{list}</div>;
  }

  return (
    <div className="h-full min-h-0">
      <Outlet />
    </div>
  );
}
