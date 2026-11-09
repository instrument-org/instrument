import { useTabSurface } from "@/client/components/window/tab-surface";
import { TaskPage } from "@/client/components/window/task-page";
import {
  type ChildTask,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";

import { useChildTask } from "./child-tasks-query";

type Child = ChildTask;

/** One task's page as a screen, told to the conversation as the task and where it stands. */
export function TaskScreen({
  chat,
  sessionId,
}: {
  chat: ChatId;
  sessionId: StoreId.Session;
}) {
  const child = useChildTask(chat, sessionId);
  useTabSurface(
    "view",
    child ? { screen: "task", task: describe(child) } : null,
  );
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
      child.status.kind === "running"
        ? ("working" as const)
        : ("done" as const),
    ...(child.status.kind === "running" ? { step: child.status.line } : {}),
    title: child.title,
  };
}
