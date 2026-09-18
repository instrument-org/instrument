import { useOrchestrator } from "@/client/components/orchestrator/context";
import { type TaskListItem } from "@/client/components/orchestrator/task-list";
import { ThreadTaskList } from "@/client/components/orchestrator/thread-task-list";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often the list re-reads where the thread's tasks stand while it is up. */
const REFRESH_MS = ms("2 seconds");

/**
 * The thread's task list as the pane's fixed view: not a tab among the
 * thread's, so nothing to close or keep track of, but a face the pane wears
 * over whatever tab is up until a tab is picked or something opens. Reads
 * the same list the window's badge does, narrowed to the tasks filed from
 * this thread.
 */
export function ThreadTasksView({
  onOpen,
  sessionId,
}: {
  /** Opens a task's page, as a tab of the thread's. */
  onOpen: (id: TaskId) => void;
  sessionId: StoreId.Session;
}) {
  const { taskId } = useOrchestrator();
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  if (!children.data) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-5" />
      </div>
    );
  }
  const items: TaskListItem[] = children.data
    .filter((child) => child.threadId === sessionId)
    .map((child) => ({
      ...(child.threadTitle ? { threadTitle: child.threadTitle } : {}),
      id: child.id,
      line: child.standing.line,
      standing: child.standing.kind,
      title: child.title,
      updatedAt: child.updatedAt,
    }));
  return <ThreadTaskList items={items} onOpen={onOpen} />;
}
