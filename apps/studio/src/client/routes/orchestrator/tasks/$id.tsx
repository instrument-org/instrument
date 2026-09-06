import { ChildTranscript } from "@/client/components/orchestrator/child-tasks";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { Spinner } from "@/client/components/ui/spinner";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import ms from "ms";

const REFRESH_MS = ms("2 seconds");

/** One task's own chat, beside the list: how the user looks over the orchestrator's shoulder. */
export const Route = createFileRoute("/orchestrator/tasks/$id")({
  component: TaskRoute,
});

function TaskRoute() {
  const { id } = Route.useParams();
  const taskId = TaskIdSchema.parse(id);
  const orchestrator = useOrchestrator();
  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: [taskId] },
      refetchInterval: REFRESH_MS,
    }),
  );
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: { id: orchestrator.taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const isWorking = status.data?.some(hasLiveAgent) ?? false;
  const step = activity.data?.running.find(
    (entry) => entry.taskId === taskId,
  )?.step;
  useOnScreen(
    task.data
      ? {
          screen: "task",
          task: {
            id: taskId,
            status: isWorking ? "working" : "done",
            ...(step ? { step } : {}),
            title: task.data.title,
          },
        }
      : null,
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
        <ChildTranscript key={taskId} task={task.data} />
      </div>
    </div>
  );
}
