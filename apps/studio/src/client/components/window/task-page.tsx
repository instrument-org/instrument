import { TaskBackgroundProcesses } from "@/client/components/task/task-background-processes";
import { TaskUsageSummary } from "@/client/components/task/usage-summary";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { ChildTranscript } from "@/client/components/window/child-tasks";
import { useNewestSessionId } from "@/client/components/window/newest-session";
import { TaskMenu } from "@/client/components/window/task-menu";
import {
  useIsTaskWorking,
  useTaskHold,
} from "@/client/components/window/task-working";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useMutation, useQuery } from "@tanstack/react-query";

/**
 * One task's own chat, in its chat's pane: how the user looks over the
 * conversation's shoulder. Headed by the task's title and its menu, which
 * travel together so the menu reads as acting on the task named beside it.
 * A task held from starting says what it waits on beside them, and a task
 * that left commands running shows how many, opening onto a list that stops
 * them. While the task works or waits, a Stop at the header's far end halts
 * it, or cancels its start; in developer mode the task's message and token
 * totals sit beside it. Nothing names the chat: the page stands under it.
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
  const isWorking = useIsTaskWorking(taskId);
  const held = useTaskHold(taskId);
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const isDeveloperMode = useDeveloperMode();
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
        {held ? (
          <span className="min-w-0 truncate text-sm text-warning-700 dark:text-warning-300">
            {held}
          </span>
        ) : null}
        <TaskBackgroundProcesses taskId={taskId} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isDeveloperMode && <TaskUsageSummary taskId={taskId} />}
          {(isWorking || held !== undefined) && (
            <Button
              className="shrink-0"
              disabled={stop.isPending}
              onClick={() => {
                stop.mutate({ id: taskId });
              }}
              size="xs"
              variant="outline"
            >
              <StopIcon weight="fill" />
              Stop
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ChildTranscript key={taskId} task={task.data} />
      </div>
    </div>
  );
}
