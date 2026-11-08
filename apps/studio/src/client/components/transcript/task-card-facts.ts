import { type RPCOutput } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";

import { type TaskCardFacts } from "./surface";

type ChildTask = RPCOutput["workspace"]["chats"]["tasks"][number];

/**
 * What a task's card says, from its stretch of the task's log: the one from
 * `from`, the message a send put there, or the task's first without one. Only
 * the task's last stretch is live: an earlier one ended at the next message
 * the chat sent, and reads as it ended there whatever the task has done since.
 */
export function taskCardFacts(
  task: ChildTask,
  from?: StoreId.Message,
): TaskCardFacts {
  const index =
    from === undefined
      ? 0
      : task.slices.findIndex((slice) => slice.from === from);
  const slice = task.slices[index];
  const span = slice && {
    ranMs: slice.endedAt.getTime() - slice.startedAt.getTime(),
    startedAt: slice.startedAt,
  };
  if (span && index < task.slices.length - 1) {
    return {
      ...(slice.line !== undefined && { ended: slice.line }),
      failed: false,
      ...span,
      stoppable: false,
      title: task.title,
      working: false,
    };
  }
  // The task's last stretch, or a send the list has not read yet, which is
  // newer than every stretch it has.
  return {
    ended: task.status.summary ?? task.status.line,
    failed: task.status.kind === "failed",
    ...(task.status.kind === "waiting" && { waiting: true }),
    ...(!task.working && {
      ranMs: span?.ranMs ?? task.updatedAt.getTime() - task.createdAt.getTime(),
    }),
    ...(span && { startedAt: span.startedAt }),
    ...(task.step && { step: task.step }),
    stoppable: task.stoppable,
    title: task.title,
    working: task.working,
  };
}
