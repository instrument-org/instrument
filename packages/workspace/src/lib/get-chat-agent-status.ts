import { ok } from "neverthrow";

import { type WorkspaceActorRef } from "../machines/workspace";
import {
  type SessionTag,
  type ChatAgentStatus,
} from "../schemas/chat-agent-status";
import { type ChatId } from "../schemas/chat-id";

export function getChatAgentStatus({
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

  const taskAgentStatus: ChatAgentStatus = {
    sessionActors,
    chatId: id,
  };

  return ok(taskAgentStatus);
}
