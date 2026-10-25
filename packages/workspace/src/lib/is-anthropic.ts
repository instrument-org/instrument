import type { AIGatewayModel } from "@instrument-org/ai-gateway";

/**
 * Whether requests to `model` reach an Anthropic model, so they take
 * Anthropic's cache breakpoints and tool call id rules.
 *
 * A model that stands for another, such as `instrument/auto`, counts while
 * the model our gateway resolves it to right now is Anthropic's, read from
 * its `sourceModelId`, and stops counting once the gateway points it
 * elsewhere. The alias's `maker` decides only for a gateway that reports no
 * `sourceModelId`.
 */
export function isAnthropic(model: AIGatewayModel.Type): boolean {
  return (
    model.author === "anthropic" ||
    model.params.provider === "anthropic" ||
    model.canonicalId.includes("anthropic") ||
    model.canonicalId.includes("claude") ||
    resolvesToAnthropic(model)
  );
}

function resolvesToAnthropic({
  maker,
  sourceModelId,
}: AIGatewayModel.Type): boolean {
  if (sourceModelId !== undefined) {
    return sourceModelId.startsWith("anthropic/");
  }
  return maker === "anthropic";
}
