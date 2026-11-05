import { TaskUsageSummary } from "@/client/components/task/usage-summary";
import { formatSpan, useTicking } from "@/client/components/transcript/time";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { ChildTranscript } from "@/client/components/window/child-tasks";
import { useChildTask } from "@/client/components/window/child-tasks-query";
import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useMutation } from "@tanstack/react-query";

/**
 * One task's own conversation, in its chat's pane: how the user looks over
 * the agent's shoulder. Headed by the task's title. While the task works or
 * waits on a card, a Stop at the header's far end halts it, with how long it
 * has run while it works; once it is done, how long that took stands there
 * instead. In developer mode the task's message and token totals sit beside it.
 * Nothing names the chat: the page stands under it.
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
  const isDeveloperMode = useTabDeveloperMode();
  const now = useTicking(task?.working === true);
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
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {task.title}
        </h2>
        {isDeveloperMode && (
          <TaskUsageSummary sessionId={sessionId} chatId={chat} />
        )}
        {task.stoppable && (
          <Button
            className="shrink-0 tabular-nums"
            disabled={stop.isPending}
            onClick={() => {
              stop.mutate({ id: chat, sessionId });
            }}
            size="xs"
            variant="outline"
          >
            <StopIcon weight="fill" />
            Stop
            {task.working && ` · ${formatSpan(now - task.createdAt.getTime())}`}
          </Button>
        )}
        {!task.stoppable && task.standing.kind === "done" && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            Done in{" "}
            {formatSpan(task.updatedAt.getTime() - task.createdAt.getTime())}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ChildTranscript
          chat={chat}
          isWorking={task.working}
          key={sessionId}
          sessionId={sessionId}
          stoppedBy={task.working ? undefined : task.stoppedBy}
        />
      </div>
    </div>
  );
}
