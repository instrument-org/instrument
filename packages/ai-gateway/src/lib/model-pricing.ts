import { type AIGatewayModel } from "../schemas/model";

/**
 * OpenRouter-shaped lists price a model in dollars per token, as strings, and
 * write a negative number where the price is not known. Dollars per million
 * tokens is the unit every price sheet uses, so that is what a model carries.
 * Either side missing means the model is not priced rather than half priced.
 */
export function pricingPerMillionTokens(
  pricing:
    | null
    | undefined
    | { completion?: null | string; prompt?: null | string },
): AIGatewayModel.Pricing | undefined {
  const input = perMillionTokens(pricing?.prompt);
  const output = perMillionTokens(pricing?.completion);
  return input === undefined || output === undefined
    ? undefined
    : { input, output };
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
