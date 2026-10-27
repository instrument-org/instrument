import { type AIGatewayModel } from "../schemas/model";

/**
 * OpenRouter-shaped lists price a model in dollars per token, as strings, and
 * write a negative number where the price is not known. Dollars per million
 * tokens is the unit every price sheet uses, so that is what a model carries.
 * Either side missing means the model is not priced rather than half priced.
 *
 * A model billed at a higher rate past a prompt size lists that rate under
 * `overrides`, from `min_prompt_tokens`; the smallest size where the prompt
 * price rises is kept as `higherPriceFromPromptTokens`.
 */
export function pricingPerMillionTokens(
  pricing:
    | null
    | undefined
    | {
        completion?: null | string;
        overrides?:
          | null
          | { min_prompt_tokens?: null | number; prompt?: null | string }[];
        prompt?: null | string;
      },
): AIGatewayModel.Pricing | undefined {
  const input = perMillionTokens(pricing?.prompt);
  const output = perMillionTokens(pricing?.completion);
  if (input === undefined || output === undefined) {
    return undefined;
  }
  const steps = (pricing?.overrides ?? []).flatMap((override) => {
    const from = override.min_prompt_tokens;
    const price = perMillionTokens(override.prompt);
    return typeof from === "number" &&
      Number.isInteger(from) &&
      from > 0 &&
      price !== undefined &&
      price > input
      ? [from]
      : [];
  });
  return steps.length === 0
    ? { input, output }
    : { higherPriceFromPromptTokens: Math.min(...steps), input, output };
}

function perMillionTokens(perToken: null | string | undefined) {
  if (perToken === null || perToken === undefined) {
    return;
  }
  const dollars = Number(perToken);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return;
  }
  // Three decimals keeps a tenth of a cent, which is where the cheapest models
  // are priced, without carrying float noise into what gets displayed.
  return Math.round(dollars * 1_000_000 * 1000) / 1000;
}
