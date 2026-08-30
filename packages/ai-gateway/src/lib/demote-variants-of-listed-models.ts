import { type AIGatewayModel } from "../schemas/model";

/**
 * Suffixes that name a step up from a base model rather than a tier of its own:
 * a reasoning mode, a priority lane, an extended-thinking build. The cheaper
 * tiers (mini, nano, lite, flash, air) are deliberately absent, because those
 * are a different choice rather than the same one at a markup.
 */
const VARIANT_SUFFIXES = [
  "customtools",
  "fast",
  "high",
  "max",
  "multi-agent",
  "pro",
  "reasoning",
  "thinking",
  "turbo",
];

/**
 * Takes `recommended` and `default` off any model whose id is another model in
 * the same list plus one of those suffixes.
 *
 * The list already carries the thing the variant is a step up from, so without
 * this the two sit side by side under one heading: either the variant costs
 * several times its base for the same weights (Claude Opus 5 Fast at twice
 * Opus 5, GPT-5.5 Pro at six times GPT-5.5), or it costs the same and the pair
 * reads as one model listed twice.
 *
 * Reading the relationship out of the list rather than off a vendor's naming is
 * what makes it hold: a model released after this build is judged on the same
 * terms as one released before it, a variant whose base is absent is left alone
 * because there is nothing to compare it against, and no price has to be
 * reported for any of it to work. That last part matters, since only
 * OpenRouter-shaped responses and Google report one.
 *
 * Runs over a whole provider's list, so it belongs beside the fetch rather than
 * in `addHeuristicTags`, which only ever sees one model.
 */
export function demoteVariantsOfListedModels(
  models: AIGatewayModel.Type[],
): AIGatewayModel.Type[] {
  const listed = new Set<string>(models.map((model) => model.canonicalId));

  return models.map((model) => {
    if (!hasListedBase(model.canonicalId, listed)) {
      return model;
    }

    return {
      ...model,
      tags: model.tags.filter(
        (tag) => tag !== "recommended" && tag !== "default",
      ),
    };
  });
}

function hasListedBase(canonicalId: string, listed: Set<string>): boolean {
  return VARIANT_SUFFIXES.some(
    (suffix) =>
      canonicalId.endsWith(`-${suffix}`) &&
      listed.has(canonicalId.slice(0, -(suffix.length + 1))),
  );
}
