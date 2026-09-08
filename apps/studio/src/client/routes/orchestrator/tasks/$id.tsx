import { ChannelFace } from "@/client/components/orchestrator/channel-rail";
import { ChildTranscript } from "@/client/components/orchestrator/child-tasks";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useNewestSessionId } from "@/client/components/orchestrator/newest-session";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { TaskMenu } from "@/client/components/orchestrator/task-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { hasLiveAgent } from "@/client/lib/agent-status";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();
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
  // The channel this was asked for in, which is the task's address rather than
  // one more fact about how it ran, so it sits with the title.
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: orchestrator.taskId },
    }),
  );
  const channel = children.data?.find((child) => child.id === taskId)?.channel;
  // The session the transcript below is showing, so the menu acts on what is
  // on screen rather than on whichever session it would pick for itself.
  const sessionId = useNewestSessionId(taskId);
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
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        {/* The title and its menu travel together, so the menu reads as acting
          on the task named beside it rather than on the screen. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="min-w-0 truncate text-sm font-medium">
            {task.data.title}
          </h2>
          <TaskMenu sessionId={sessionId} taskId={taskId} />
        </div>
        {channel && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
            <ChannelFace channel={channel} className="text-[12px]" />
            {channel.name}
          </span>
        )}
        {/* Closing the task is closing this pane, not ending the work: the
          list beside it becomes the screen again, and the task goes on. */}
        <button
          aria-label="Close this task"
          className="grid size-6 shrink-0 place-items-center rounded-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground"
          onClick={() => {
            void navigate({ to: "/orchestrator/tasks" });
          }}
          title="Close"
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ChildTranscript key={taskId} task={task.data} />
      </div>
    </div>
  );
}
