import { ChatTasksScreen } from "@/client/components/window/chat-tasks-view";
import { StoreId } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/** A chat's tasks, as a tab in the chat's group: the list, narrowed to the chat named. */
export const Route = createFileRoute("/_app/tasks/")({
  component: TasksRoute,
  validateSearch: z.object({
    /** The chat whose tasks alone are listed, by session id; every task otherwise. */
    chat: z.string().optional(),
  }),
});

function TasksRoute() {
  const { chat } = Route.useSearch();
  const parsed = StoreId.SessionSchema.safeParse(chat);
  return <ChatTasksScreen chat={parsed.success ? parsed.data : undefined} />;
}
