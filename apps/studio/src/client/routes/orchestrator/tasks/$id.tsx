import { ChildChat } from "@/client/components/orchestrator/child-tasks";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

/** One task's own chat, beside the list: how the user looks over the orchestrator's shoulder. */
export const Route = createFileRoute("/orchestrator/tasks/$id")({
  component: TaskRoute,
});

function TaskRoute() {
  const { id } = Route.useParams();
  const taskId = TaskIdSchema.parse(id);
  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  if (!task.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2">
        <h2 className="truncate text-sm font-medium">{task.data.title}</h2>
      </div>
      <div className="min-h-0 flex-1">
        <ChildChat key={taskId} task={task.data} />
      </div>
    </div>
  );
}
