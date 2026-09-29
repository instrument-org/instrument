import { TaskScreen } from "@/client/components/orchestrator/chat-tasks-view";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";

/** One task's page, as a tab in its chat's group: how the person looks over the conversation's shoulder. */
export const Route = createFileRoute("/orchestrator/tasks/$id")({
  component: TaskRoute,
});

function TaskRoute() {
  const { id } = Route.useParams();
  const taskId = TaskIdSchema.safeParse(id);
  if (!taskId.success) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        No task at that address.
      </p>
    );
  }
  return <TaskScreen taskId={taskId.data} />;
}
