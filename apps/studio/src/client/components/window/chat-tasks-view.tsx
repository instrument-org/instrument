import { Spinner } from "@/client/components/ui/spinner";
import {
  ChatTaskList,
  type TaskListItem,
} from "@/client/components/window/chat-task-list";
import { useWindow } from "@/client/components/window/context";
import { useOnScreen } from "@/client/components/window/on-screen";
import { useScreenTab } from "@/client/components/window/screen-tab";
import { taskHref } from "@/client/components/window/tab-location";
import { TaskPage } from "@/client/components/window/task-page";
import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { childTasksOptions } from "./child-tasks-query";

/** How often the tasks are re-read for where they stand while one of these screens is up. */

type Child = RPCOutput["workspace"]["chats"]["tasks"][number];

/**
 * A chat's tasks as a screen in its tab group: the tasks filed from that
 * chat, or every task with no chat named. A row pressed moves the same tab
 * to the task's page, so back returns to the list along the tab's trail.
 */
export function ChatTasksScreen({
  chat,
}: {
  chat: StoreId.Session | undefined;
}) {
  const children = useChildren();
  const screenTab = useScreenTab();
  const router = useRouter();
  const own = (children.data ?? []).filter(
    (child) => chat === undefined || child.chatSessionId === chat,
  );
  useOnScreen(
    children.data ? { screen: "tasks", tasks: own.map(describe) } : null,
  );
  const open = (id: TaskId) => {
    const href = taskHref(id, chat);
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
    stoppable: child.stoppable,
    title: child.title,
    updatedAt: child.updatedAt,
  }));
  return <ChatTaskList items={items} onOpen={open} />;
}

/** One task's page as a screen: its own chat, told to the conversation as the task and where it stands. */
export function TaskScreen({ taskId }: { taskId: TaskId }) {
  const children = useChildren();
  const child = children.data?.find((entry) => entry.id === taskId);
  useOnScreen(child ? { screen: "task", task: describe(child) } : null);
  return <TaskPage taskId={taskId} />;
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
  const appWindow = useWindow();
  return useQuery(childTasksOptions(appWindow.taskId));
}
