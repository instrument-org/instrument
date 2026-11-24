import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import {
  type AIProviderType,
  AIProviderTypeSchema,
  SYNTHETIC_MODEL_ID,
} from "@instrument-org/shared";

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
 * A message the app wrote in the agent's place (a pause at the step limit, a
 * wake that could not reach its model) asked no model, so it is looked past.
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
  messages: readonly SessionMessage.Type[];
  model: AIGatewayModel.Type;
}): SessionMessageDataPart.ModelChangeDataPart | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant" || message.metadata.synthetic) {
      continue;
    }

    // By kind of provider where one was recorded, since the same model from
    // another provider is a different model to ask; by id for a turn from
    // before. Never by connection: each computer reaches a chat's model
    // through its own connection of that kind, so a chat continued on another
    // computer asks the same model under a different address.
    const asked = message.metadata.aiGatewayModel;
    if (
      asked === undefined
        ? message.metadata.modelId === model.canonicalId
        : isSameModel(asked, model)
    ) {
      return undefined;
    }

    return {
      from: asked
        ? modelSide(asked)
        : {
            modelId: message.metadata.modelId,
            provider: providerAsked(message.metadata),
          },
      to: modelSide(model),
    };
  }

  // Nothing has answered yet, so there is no model to have moved from. The
  // first turn of a session is not a change of anything.
  return undefined;
}

/**
 * Whether two models are the one model to ask: the same model from another
 * kind of provider is a different one, and the same one through another
 * connection of that kind is not.
 */
export function isSameModel(
  a: Pick<AIGatewayModel.Type, "canonicalId" | "params">,
  b: Pick<AIGatewayModel.Type, "canonicalId" | "params">,
): boolean {
  return (
    a.canonicalId === b.canonicalId && a.params.provider === b.params.provider
  );
}

/**
 * Whether a recorded change is from a model at all. Records exist that name the
 * app's own messages as the model moved from, which no one switched from.
 */
export function isModelSwitch(
  change: SessionMessageDataPart.ModelChangeDataPart,
): boolean {
  return change.from.modelId !== SYNTHETIC_MODEL_ID;
}

/**
 * The kind of provider an assistant message asked: from the model record, or,
 * on a message written before that record was kept (1.x), from the provider id
 * stored beside the model id, which named the same kind. Absent on a synthetic
 * message, whose provider id is no provider.
 */
export function providerAsked(
  metadata: SessionMessage.Assistant["metadata"],
): AIProviderType | undefined {
  return (
    metadata.aiGatewayModel?.params.provider ??
    AIProviderTypeSchema.safeParse(metadata.providerId).data
  );
}

/**
 * The model that wrote the last reply, when the session has not been told of it
 * since it last switched models. Only a reply to the model being asked counts:
 * on the turn of a switch, what wrote the reply before it is another model's.
 */
export function modelAnsweredSinceTold({
  messages,
  model,
}: {
  messages: readonly SessionMessage.WithParts[];
  model: AIGatewayModel.Type;
}): SessionMessageDataPart.ModelAnsweredDataPart | undefined {
  let answered: string | undefined;
  for (const message of messages.toReversed()) {
    if (message.role === "assistant" && !message.metadata.synthetic) {
      const asked = message.metadata.aiGatewayModel;
      if (!asked || !isSameModel(asked, model)) {
        break;
      }
      // The last reply's own report alone: one that failed, or that reported
      // nothing, leaves who answered it unsaid.
      answered ??= message.metadata.modelIdServed;
      if (answered === undefined) {
        return;
      }
    }
    let told: string | undefined;
    let switched = false;
    for (const part of message.parts) {
      if (part.type === "data-modelAnswered") {
        told = part.data.modelId;
      }
      switched ||= part.type === "data-modelChange";
    }
    if (told !== undefined) {
      return answered === undefined || told === answered
        ? undefined
        : { modelId: answered, providerName: model.providerName };
    }
    if (switched) {
      break;
    }
  }
  return answered === undefined
    ? undefined
    : { modelId: answered, providerName: model.providerName };
}

/**
 * The messages with each switch a run recorded on a failed reply said on the
 * user's turn it answered, where notes go to the model: the failed reply is
 * left out of what is sent, and a run again adds no turn of the user's. Several
 * on one turn read as the one move they come to.
 */
export function withSwitchesOnUserTurns(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  const result = [...messages];
  let userAt: number | undefined;
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      userAt = index;
    }
    if (message.role !== "assistant" || userAt === undefined) {
      continue;
    }
    for (const part of message.parts) {
      const user = result[userAt];
      if (part.type !== "data-modelChange" || user?.role !== "user") {
        continue;
      }
      // One recorded before a switch kept the model's facts was sent without
      // this, and is sent as it was.
      if (!isModelSwitch(part.data) || part.data.to.providerId === undefined) {
        continue;
      }
      const before = user.parts.find(
        (candidate) => candidate.type === "data-modelChange",
      );
      const from =
        before?.type === "data-modelChange" ? before.data.from : part.data.from;
      const { to } = part.data;
      const rest = user.parts.filter((candidate) => candidate !== before);
      const isBack =
        from.modelId === to.modelId && from.provider === to.provider;
      result[userAt] = {
        ...user,
        parts: isBack
          ? rest
          : [
              ...rest,
              {
                ...part,
                data: { from, to },
                metadata: { ...part.metadata, messageId: user.id },
              },
            ],
      };
    }
  }
  return result;
}

/** A model's facts as a switch records them. */
export function modelSide(
  model: AIGatewayModel.Type,
): SessionMessageDataPart.ModelChangeDataPart["from"] {
  return {
    contextLength: model.contextLength,
    family: model.family,
    // Our own models are authored by us and say who makes the model behind
    // them; any other model's author is its maker.
    maker:
      model.maker ??
      (model.author === model.params.provider ? undefined : model.author),
    modelId: model.canonicalId,
    name: model.name,
    provider: model.params.provider,
    providerId: model.providerId,
    providerName: model.providerName,
  };
}
