import { TaskBackgroundProcesses } from "@/client/components/task/task-background-processes";
import { TaskUsageSummary } from "@/client/components/task/usage-summary";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { ChildTranscript } from "@/client/components/window/child-tasks";
import { useChildTask } from "@/client/components/window/child-tasks-query";
import { TaskMenu } from "@/client/components/window/task-menu";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useMutation } from "@tanstack/react-query";

/**
 * One task's own conversation, in its chat's pane: how the user looks over
 * the agent's shoulder. Headed by the task's title and its menu, which
 * travel together so the menu reads as acting on the task named beside it.
 * A task that left commands running shows how many, opening onto a list
 * that stops them. While the task works, a Stop at the header's far end
 * halts it; in developer mode the task's message and token totals sit
 * beside it. Nothing names the chat: the page stands under it.
 */
export function TaskPage({
  chat,
  sessionId,
}: {
  chat: ChatId;
  sessionId: StoreId.Session;
}) {
  const task = useChildTask(chat, sessionId);
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const isDeveloperMode = useDeveloperMode();
  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium">{task.title}</h2>
        <TaskMenu sessionId={sessionId} chatId={chat} />
        <TaskBackgroundProcesses sessionId={sessionId} chatId={chat} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isDeveloperMode && (
            <TaskUsageSummary sessionId={sessionId} chatId={chat} />
          )}
          {task.stoppable && (
            <Button
              className="shrink-0"
              disabled={stop.isPending}
              onClick={() => {
                stop.mutate({ id: chat, sessionId });
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
        <ChildTranscript
          chat={chat}
          isWorking={task.stoppable}
          key={sessionId}
          sessionId={sessionId}
          stoppedBy={task.stoppable ? undefined : task.stoppedBy}
        />
      </div>
    </div>
  );
}
