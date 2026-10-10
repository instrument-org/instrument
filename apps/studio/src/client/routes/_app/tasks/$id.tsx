import { TaskScreen } from "@/client/components/window/chat-tasks-view";
import { chatOfTasksList } from "@/client/components/window/tab-location";
import { StoreId } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * One task's page, as a tab in its chat's group: how the person looks over
 * the conversation's shoulder. A task is a session in its chat's store, so
 * the address names both.
 */
export const Route = createFileRoute("/_app/tasks/$id")({
  component: TaskRoute,
  validateSearch: z.object({
    /** The chat the task was started in. */
    chat: z.string().optional(),
  }),
});

function TaskRoute() {
  const { id } = Route.useParams();
  const chat = chatOfTasksList(Route.useSearch().chat);
  const sessionId = StoreId.SessionSchema.safeParse(id);
  if (!sessionId.success || chat === undefined) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        No task at that address.
      </p>
    );
  }
  return <TaskScreen chat={chat} sessionId={sessionId.data} />;
}
