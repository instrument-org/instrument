import { type TaskId } from "@instrument-org/workspace/client";

import { skipToken } from "@tanstack/react-query";

import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";

/**
 * The tasks the window has filed, kept current by the workspace as any of
 * them changes rather than asked for again on a timer. Every reader passes
 * the same options, so they share one subscription, and a task that did not
 * change keeps its object across updates.
 */
export function childTasksOptions(taskId: TaskId | typeof skipToken) {
  return rpcClient.workspace.chats.live.tasks.experimental_liveOptions({
    input: taskId === skipToken ? skipToken : { id: taskId },
    structuralSharing: shareEqualDeep,
  });
}
