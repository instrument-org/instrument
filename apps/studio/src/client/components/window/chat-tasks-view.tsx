import { Spinner } from "@/client/components/ui/spinner";
import {
  ChatTaskList,
  type TaskListItem,
} from "@/client/components/window/chat-task-list";
import { useOnScreen } from "@/client/components/window/on-screen";
import { taskHref } from "@/client/components/window/tab-location";
import { useWindow } from "@/client/components/window/context";
import { TaskPage } from "@/client/components/window/task-page";
import {
  type ChildTask,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useRouter } from "@tanstack/react-router";

import { useChatTasks, useChildTask } from "./child-tasks-query";

/** How often the tasks are re-read for where they stand while one of these screens is up. */

type Child = ChildTask;

/**
 * A chat's tasks as a screen in its tab group: the tasks filed from that
 * chat. A row pressed moves the same tab to the task's page, so back
 * returns to the list.
 */
export function ChatTasksScreen({ chat }: { chat: ChatId }) {
  const children = useChatTasks(chat);
  const router = useRouter();
  const { openScreen } = useWindow();
  const own = children.data ?? [];
  useOnScreen(
    children.data ? { screen: "tasks", tasks: own.map(describe) } : null,
  );
  const open = (id: StoreId.Session) => {
    router.history.push(taskHref(id, chat));
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
  return (
    <ChatTaskList
      chat={chat}
      items={items}
      onOpen={open}
      onOpenInNewTab={(id) => {
        openScreen(taskHref(id, chat), { behind: true, newTab: true });
      }}
    />
  );
}

/** One task's page as a screen, told to the conversation as the task and where it stands. */
export function TaskScreen({
  chat,
  sessionId,
}: {
  chat: ChatId;
  sessionId: StoreId.Session;
}) {
  const child = useChildTask(chat, sessionId);
  useOnScreen(child ? { screen: "task", task: describe(child) } : null);
  return <TaskPage chat={chat} sessionId={sessionId} />;
}

/**
 * A task as the conversation is told it: by the handle its `task` command
 * takes, what it is called, and where it stands.
 */
function describe(child: Child) {
  return {
    id: child.handle,
    status:
      child.standing.kind === "running"
        ? ("working" as const)
        : ("done" as const),
    ...(child.standing.kind === "running" ? { step: child.standing.line } : {}),
    title: child.title,
  };
}
