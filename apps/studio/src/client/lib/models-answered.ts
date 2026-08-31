import {
  type AIGatewayModel,
  isRouterModel,
  namesSameModel,
} from "@instrument-org/ai-gateway/client";
import { type SessionMessage } from "@instrument-org/workspace/client";

/**
 * A model that answered, as far as the transcript can say. The record when the
 * catalog had one at the time, and the provider's own id when it did not, which
 * is ordinary for a model released between two refreshes of the list.
 */
export interface AnsweringModel {
  model?: AIGatewayModel.Type;
  providerId: string;
}

/**
 * What one requested model produced across an assistant turn.
 *
 * `served` is empty on the ordinary turn, where the provider named the model we
 * asked for or named nothing at all. It has entries only where the provider
 * named something else, and more than one where a router picked per step.
 */
export interface ModelUsage {
  kind: "ordinary" | "routed" | "substituted";
  modelId: string;
  requested?: AIGatewayModel.Type;
  served: AnsweringModel[];
}

export function modelName(model: AnsweringModel): string {
  return model.model?.name.trim() || model.providerId;
}

/**
 * The models an assistant turn asked for and the models that answered.
 *
 * Grouped by what was requested, because that is the one the reader chose and
 * so the one a row of chips is a list of. A router picking two models across a
 * turn is one entry with two answers rather than two entries, which is also why
 * the group cannot be keyed on what answered.
 */
export function modelsAnswering(
  messages: SessionMessage.AssistantWithParts[],
): ModelUsage[] {
  const usageByRequest = new Map<string, ModelUsage>();

  for (const message of messages) {
    const { aiGatewayModel, aiGatewayModelServed, modelId, modelIdServed } =
      message.metadata;

    if (!modelId || message.metadata.synthetic) {
      continue;
    }

    const key = aiGatewayModel?.uri ?? modelId;
    const usage: ModelUsage = usageByRequest.get(key) ?? {
      kind: "ordinary",
      modelId,
      requested: aiGatewayModel,
      served: [],
    };

    // Compared here as well as before it is stored, because a message recorded
    // before the field held only differences carries the requested id back as
    // though a provider had named it.
    if (
      modelIdServed &&
      !namesSameModel(aiGatewayModel?.providerId, modelIdServed)
    ) {
      if (!usage.served.some((s) => s.providerId === modelIdServed)) {
        usage.served.push({
          model: aiGatewayModelServed,
          providerId: modelIdServed,
        });
      }
      // Substituted is a claim about what was asked for, so it needs the
      // record of what was asked for. Without one the served model is still
      // the answer, and the card names it without accusing the provider of
      // anything.
      usage.kind = isRouterModel(aiGatewayModel)
        ? "routed"
        : aiGatewayModel
          ? "substituted"
          : "ordinary";
    }

    usageByRequest.set(key, usage);
  }

  return [...usageByRequest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, usage]) => usage);
}
