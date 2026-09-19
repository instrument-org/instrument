import { useOrchestrator } from "@/client/components/orchestrator/context";
import { TaskPage } from "@/client/components/orchestrator/task-page";
import {
  type TaskListItem,
  ThreadTaskList,
} from "@/client/components/orchestrator/thread-task-list";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often the list re-reads where the thread's tasks stand while it is up. */
const REFRESH_MS = ms("2 seconds");

/** The face as the window holds it: whose tasks, which one, and what it stands over. */
export interface TasksFace {
  /** The task left for the list, so forward returns to it. */
  forward?: TaskId;
  /** The tab the face was brought up over; a change under it puts the face away. */
  overTab: string | undefined;
  /** The task whose page is up, or nothing for the list. */
  task?: TaskId;
  thread: StoreId.Session;
}

/**
 * The thread's tasks as the pane's fixed view: not a tab among the
 * thread's, so nothing to close or keep track of, but a face the pane wears
 * over whatever tab is up until a tab is picked or something opens. The
 * list, narrowed to the tasks filed from this thread, or one task's page
 * when one is chosen; the row over the pane says which and walks between
 * them.
 */
export function ThreadTasksView({
  onOpen,
  sessionId,
  taskId,
}: {
  /** Opens a task's page in the face's place. */
  onOpen: (id: TaskId) => void;
  sessionId: StoreId.Session;
  /** The task whose page the face shows, or nothing for the list. */
  taskId: TaskId | undefined;
}) {
  const orchestrator = useOrchestrator();
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: orchestrator.taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  if (taskId !== undefined) {
    return <TaskPage taskId={taskId} />;
  }
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
      id: child.id,
      line: child.standing.line,
      standing: child.standing.kind,
      title: child.title,
      updatedAt: child.updatedAt,
    }));
  return <ThreadTaskList items={items} onOpen={onOpen} />;
}
