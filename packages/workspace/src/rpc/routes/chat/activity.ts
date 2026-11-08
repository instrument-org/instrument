import { liveRead } from "../../live-read";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";
import { z } from "zod";

import { getChatAgentStatus } from "../../../lib/get-chat-agent-status";
import { type WorkspaceActorRef } from "../../../machines/workspace";
import {
  type ChatAgentStatus,
  ChatAgentStatusSchema,
} from "../../../schemas/chat-agent-status";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";
import { recordChanges } from "../../../lib/record-changes";

/** The sessions of one chat whose agent is alive, its tasks' included. */
function getChatActivity(
  id: ChatId,
  workspaceRef: WorkspaceActorRef,
): ChatAgentStatus {
  return {
    chatId: id,
    sessionActors: getChatAgentStatus({
      id,
      workspaceRef,
    }).value.sessionActors.filter((sessionActor) =>
      sessionActor.tags.includes("agent.alive"),
    ),
  };
}

/** One chat's live agents, read again only when an agent of that chat moves. */
export const liveChatActivity = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(ChatAgentStatusSchema))
  .handler(async function* ({ context, input, signal }) {
    let previousState: ChatAgentStatus | undefined;
    for await (const currentState of liveRead({
      changes: [
        recordChanges(
          signal,
          (change) => change.id === input.id && change.kind === "agent",
        ),
      ],
      read: () => getChatActivity(input.id, context.workspaceRef),
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
