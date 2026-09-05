import { TaskChat } from "@/client/components/task/chat";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often a task's sessions are re-read while it is open. */
const REFRESH_MS = ms("2 seconds");

/**
 * A task's own chat, on its own screen. The escape hatch: the orchestrator is
 * meant to be the only thing the user talks to, and this is how they look
 * over its shoulder.
 */
export function ChildChat({ task }: { task: Task }) {
  const sessions = useQuery(
    rpcClient.workspace.session.list.queryOptions({
      input: { id: task.id },
      refetchInterval: REFRESH_MS,
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { id: task.id },
    }),
  );
  // Newest session: ids are ulids, so the last one alphabetically.
  const sessionId = sessions.data
    ?.map((session) => session.id)
    .toSorted()
    .at(-1);

  if (!state.data || !sessionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <TaskChat
      navigateOnSend={false}
      promptDraft={state.data.promptDraft ?? ""}
      selectedModelURI={state.data.selectedModelURI}
      selectedSessionId={sessionId}
      task={task}
    />
  );
}
