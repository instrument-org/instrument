import type { AIGatewayModel } from "@instrument-org/ai-gateway";

import { OUR_MODELS } from "@instrument-org/shared";

export function isAnthropic(model: AIGatewayModel.Type): boolean {
  return (
    model.author === "anthropic" ||
    model.params.provider === "anthropic" ||
    model.canonicalId.includes("anthropic") ||
    model.canonicalId.includes("claude") ||
    (model.params.provider === OUR_MODELS.providerType &&
      model.providerId === OUR_MODELS.text.id)
  );
}
