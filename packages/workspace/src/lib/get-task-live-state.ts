import { ok } from "neverthrow";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type TaskId } from "../schemas/task-id";
import {
  type SessionTag,
  type TaskLiveState,
} from "../schemas/task-live-state";
import { getTask } from "./get-task";

export async function getTaskLiveState({
  id,
  workspaceRef,
}: {
  id: TaskId;
  workspaceRef: WorkspaceActorRef;
}) {
  const snapshot = workspaceRef.getSnapshot();
  const context = snapshot.context;

  const task = await getTask(id);

  const sessionRefs = context.sessionRefsByTaskId.get(id) ?? [];
  const sessionActors = sessionRefs.map((sessionRef) => {
    const sessionSnapshot = sessionRef.getSnapshot();
    return {
      sessionId: sessionSnapshot.context.sessionId,
      // Casting shouldn't be necessary, but only .hasTag() accept proper types
      tags: [...sessionSnapshot.tags] as SessionTag[],
    };
  });

  const taskLiveState: TaskLiveState = {
    sessionActors,
    task,
  };

  return ok(taskLiveState);
}
