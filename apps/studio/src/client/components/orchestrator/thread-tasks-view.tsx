import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useScreenTab } from "@/client/components/orchestrator/screen-tab";
import { taskHref } from "@/client/components/orchestrator/tab-location";
import { TaskPage } from "@/client/components/orchestrator/task-page";
import {
  type TaskListItem,
  ThreadTaskList,
} from "@/client/components/orchestrator/thread-task-list";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import ms from "ms";

/** How often the tasks are re-read for where they stand while one of these screens is up. */
const REFRESH_MS = ms("2 seconds");

type Child = RPCOutput["workspace"]["orchestrator"]["children"][number];

/** One task's page as a screen: its own chat, told to the conversation as the task and where it stands. */
export function TaskScreen({ taskId }: { taskId: TaskId }) {
  const children = useChildren();
  const child = children.data?.find((entry) => entry.id === taskId);
  useOnScreen(child ? { screen: "task", task: describe(child) } : null);
  return <TaskPage taskId={taskId} />;
}

/**
 * A chat's tasks as a screen in its tab group: the tasks filed from that
 * chat, or every task with no chat named. A row pressed moves the same tab
 * to the task's page, so back returns to the list along the tab's trail.
 */
export function ThreadTasksScreen({
  thread,
}: {
  thread: StoreId.Session | undefined;
}) {
  const children = useChildren();
  const screenTab = useScreenTab();
  const router = useRouter();
  const own = (children.data ?? []).filter(
    (child) => thread === undefined || child.threadId === thread,
  );
  useOnScreen(
    children.data ? { screen: "tasks", tasks: own.map(describe) } : null,
  );
  const open = (id: TaskId) => {
    const href = taskHref(id, thread);
    if (screenTab) {
      screenTab.visit(href);
    } else {
      router.history.push(href);
    }
  };
  if (!children.data) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-5" />
      </div>
    );
  }
  const items: TaskListItem[] = own.map((child) => ({
    id: child.id,
    line: child.standing.line,
    standing: child.standing.kind,
    title: child.title,
    updatedAt: child.updatedAt,
  }));
  return <ThreadTaskList items={items} onOpen={open} />;
}

/** A task as the conversation is told it: what it is called and where it stands. */
function describe(child: Child) {
  return {
    id: child.id,
    status:
      child.standing.kind === "running"
        ? ("working" as const)
        : ("done" as const),
    ...(child.standing.kind === "running" ? { step: child.standing.line } : {}),
    title: child.title,
  };
}

/** The conversation's tasks, re-read while a tasks screen is up. */
function useChildren() {
  const orchestrator = useOrchestrator();
  return useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: orchestrator.taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
}
