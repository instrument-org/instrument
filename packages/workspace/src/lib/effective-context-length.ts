import { type AIGatewayModel } from "@instrument-org/ai-gateway";

/**
 * Shrink every model's context window to this many tokens.
 *
 * Reaching a real context limit costs a session large enough that the budget
 * and rollover paths would be exercised once and then never again. Setting this
 * to a few thousand tokens puts a three-turn conversation over every threshold,
 * against real models and real reported usage, so the behavior can be checked
 * as cheaply and as often as any other.
 *
 * It can only shrink a window that is already known. A model whose length the
 * provider never reported stays unknown, because pretending to know one is the
 * bug this feature is most likely to ship.
 */
const OVERRIDE_ENV_VAR = "INSTRUMENT_CONTEXT_LENGTH_OVERRIDE";

export function effectiveContextLength(
  model: AIGatewayModel.Type,
): number | undefined {
  if (model.contextLength === undefined) {
    return undefined;
  }

  const override = Number(process.env[OVERRIDE_ENV_VAR]);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(model.contextLength, Math.floor(override));
  }

  return model.contextLength;
}
