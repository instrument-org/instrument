import { liveRead } from "../../live-read";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";

import { getChatAgentStatus } from "../../../lib/get-chat-agent-status";
import { type WorkspaceActorRef } from "../../../machines/workspace";
import {
  type ChatAgentStatus,
  ChatAgentStatusSchema,
} from "../../../schemas/chat-agent-status";
import { base } from "../../base";
import { recordChanges } from "../../../lib/record-changes";

function getTaskActivity(workspaceRef: WorkspaceActorRef) {
  const activity: ChatAgentStatus[] = [];
  const { sessionRefsByChatId } = workspaceRef.getSnapshot().context;

  for (const id of sessionRefsByChatId.keys()) {
    const sessionActors = getChatAgentStatus({
      id,
      workspaceRef,
    }).value.sessionActors.filter((sessionActor) =>
      sessionActor.tags.includes("agent.alive"),
    );

    if (sessionActors.length > 0) {
      activity.push({ sessionActors, chatId: id });
    }
  }

  return activity;
}

export const liveChatActivity = base
  .output(eventIterator(ChatAgentStatusSchema.array()))
  .handler(async function* ({ context, signal }) {
    let previousState: ChatAgentStatus[] | undefined;
    for await (const currentState of liveRead({
      changes: [recordChanges(signal, (change) => change.kind === "agent")],
      read: () => getTaskActivity(context.workspaceRef),
    })) {
      if (
        previousState === undefined ||
        !isEqual(currentState, previousState)
      ) {
        previousState = currentState;
        yield currentState;
      }
    }
  });
