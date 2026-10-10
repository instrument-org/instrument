import { ok } from "neverthrow";

import { type WorkspaceActorRef } from "../machines/workspace";
import {
  type SessionTag,
  type TaskAgentStatus,
} from "../schemas/task-agent-status";
import { type ChatId } from "../schemas/chat-id";

export function getTaskAgentStatus({
  id,
  workspaceRef,
}: {
  id: ChatId;
  workspaceRef: WorkspaceActorRef;
}) {
  const snapshot = workspaceRef.getSnapshot();
  const context = snapshot.context;

  const sessionRefs = context.sessionRefsByChatId.get(id) ?? [];
  const sessionActors = sessionRefs.map((sessionRef) => {
    const sessionSnapshot = sessionRef.getSnapshot();
    return {
      sessionId: sessionSnapshot.context.sessionId,
      // Casting shouldn't be necessary, but only .hasTag() accept proper types
      tags: [...sessionSnapshot.tags] as SessionTag[],
    };
  });

  const taskAgentStatus: TaskAgentStatus = {
    sessionActors,
    taskId: id,
  };

  return ok(taskAgentStatus);
}
