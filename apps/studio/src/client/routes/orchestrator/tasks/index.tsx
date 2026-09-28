import { ThreadTasksScreen } from "@/client/components/orchestrator/thread-tasks-view";
import { StoreId } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/** A chat's tasks, as a tab in the chat's group: the list, narrowed to the chat named. */
export const Route = createFileRoute("/orchestrator/tasks/")({
  component: TasksRoute,
  validateSearch: z.object({
    /** The chat whose tasks alone are listed, by session id; every task otherwise. */
    thread: z.string().optional(),
  }),
});

function TasksRoute() {
  const { thread } = Route.useSearch();
  const parsed = StoreId.SessionSchema.safeParse(thread);
  return (
    <ThreadTasksScreen thread={parsed.success ? parsed.data : undefined} />
  );
}
