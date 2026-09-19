import { ChildTranscript } from "@/client/components/orchestrator/child-tasks";
import { useNewestSessionId } from "@/client/components/orchestrator/newest-session";
import { TaskMenu } from "@/client/components/orchestrator/task-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

/**
 * One task's own chat, in its thread's pane: how the user looks over the
 * conversation's shoulder. Headed by the task's title and its menu, which
 * travel together so the menu reads as acting on the task named beside it.
 * Nothing names the thread: the page stands under it.
 */
export function TaskPage({ taskId }: { taskId: TaskId }) {
  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  // The session the transcript below is showing, so the menu acts on what is
  // on screen rather than on whichever session it would pick for itself.
  const sessionId = useNewestSessionId(taskId);
  if (!task.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium">
          {task.data.title}
        </h2>
        <TaskMenu sessionId={sessionId} taskId={taskId} />
      </div>
      <div className="min-h-0 flex-1">
        <ChildTranscript key={taskId} task={task.data} />
      </div>
    </div>
  );
}
