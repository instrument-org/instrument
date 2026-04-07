import type { AIGatewayModel } from "@instrument-org/ai-gateway";

import { OUR_AUTO_MODEL_ID } from "@instrument-org/shared";

export function isAnthropic(model: AIGatewayModel.Type): boolean {
  return (
    model.author === "anthropic" ||
    model.params.provider === "anthropic" ||
    model.canonicalId.includes("anthropic") ||
    model.canonicalId.includes("claude") ||
    (model.params.provider === "quests" &&
      model.providerId === OUR_AUTO_MODEL_ID)
  );
}
