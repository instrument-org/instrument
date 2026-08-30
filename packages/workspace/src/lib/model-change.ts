import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

/**
 * The move to a different model, when this request is the first one making it.
 *
 * The model a task runs on is chosen per request, so a session can change model
 * between any two turns and nothing in the transcript says so. What the model
 * was last asked is recoverable, though: every assistant message records the
 * model it was created for, before the request goes out, so a turn that failed
 * or was aborted still says which model it was asking. That makes the newest
 * assistant message the reliable answer to "what did this session ask last",
 * and it is why this is self-limiting -- the turn after a change records the
 * new model itself, so the change stops being new.
 *
 * Both windows come along because they are what the move costs, and because
 * they are the fact that separates the move worth acting on from the one that
 * is free: only a move to a smaller window can put a history that fit outside
 * the window, and nothing in a pair of model ids says which direction that is.
 *
 * The display names come along because this is the only moment they are known.
 * A name resolved when the transcript is read would be the name of whatever
 * answers to that id then, and nothing at all once the provider it came from is
 * disconnected. Absent on a turn recorded before the model was stored beside
 * it, which is what the id is the fallback for.
 */
export function modelChangeSincePreviousTurn({
  messages,
  model,
}: {
  messages: readonly SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
}): SessionMessageDataPart.ModelChangeDataPart | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    if (message.metadata.modelId === model.canonicalId) {
      return undefined;
    }

    return {
      from: {
        contextLength: message.metadata.aiGatewayModel?.contextLength,
        modelId: message.metadata.modelId,
        name: message.metadata.aiGatewayModel?.name,
      },
      to: {
        contextLength: model.contextLength,
        modelId: model.canonicalId,
        name: model.name,
      },
    };
  }

  // Nothing has answered yet, so there is no model to have moved from. The
  // first turn of a session is not a change of anything.
  return undefined;
}
