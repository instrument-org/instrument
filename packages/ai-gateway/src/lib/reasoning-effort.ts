import { type SharedV2ProviderOptions } from "@ai-sdk/provider";

import { type AIGatewayModel } from "../schemas/model";

/**
 * One ladder we can name a level on, translated into each provider's own words
 * at the last moment. There is no shared vocabulary to adopt: across the models
 * whose catalog entry names its levels there are more than twenty distinct
 * sets, so a level we hold has to be one we translate rather than one we pass
 * through.
 */
export const REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

interface ProviderReasoning {
  /**
   * Our rungs in the provider's words. A rung the provider does not offer is
   * left out, and resolution steps down to the nearest one it does, so `max`
   * against a provider that stops at high asks for high rather than failing.
   */
  levels: Partial<Record<ReasoningEffort, string>>;
  options: (effort: string) => SharedV2ProviderOptions;
}

/**
 * Keyed by the family in an AI SDK provider id, which is everything before the
 * first dot: `openai.responses` and `openai.chat` are one entry, and the key
 * matches the `providerOptions` namespace the SDK reads.
 */
const PROVIDERS: Record<string, ProviderReasoning> = {
  anthropic: {
    levels: { high: "high", low: "low", max: "max", medium: "medium" },
    options: (effort) => ({ anthropic: { effort } }),
  },
  google: {
    // `minimal` is the lowest thinking this provider offers and the nearest
    // thing it has to off, so `none` lands there rather than nowhere.
    levels: { high: "high", low: "low", medium: "medium", none: "minimal" },
    options: (effort) => ({
      google: { thinkingConfig: { thinkingLevel: effort } },
    }),
  },
  openai: {
    levels: {
      high: "high",
      low: "low",
      max: "xhigh",
      medium: "medium",
      none: "none",
    },
    options: (effort) => ({ openai: { reasoningEffort: effort } }),
  },
  // Every provider type without an SDK of its own, Workers AI among them, is
  // reached through `@ai-sdk/openai-compatible`, whose family key is the
  // config's own type. It reads the level from a `openaiCompatible` namespace
  // rather than one named for the family, and refuses `xhigh`, which is
  // OpenAI's word and not a value the endpoints behind this share -- so `max`
  // asks for `high` here rather than for a word that would be rejected.
  "openai-compatible": {
    levels: { high: "high", low: "low", max: "high", medium: "medium" },
    options: (effort) => ({ openaiCompatible: { reasoningEffort: effort } }),
  },
  openrouter: {
    levels: {
      high: "high",
      low: "low",
      max: "xhigh",
      medium: "medium",
      none: "none",
    },
    options: (effort) => ({ openrouter: { reasoning: { effort } } }),
  },
  xai: {
    levels: { high: "high", low: "low" },
    options: (effort) => ({ xai: { reasoningEffort: effort } }),
  },
};

/**
 * The provider options that ask `model` to think at `effort`, or nothing when
 * we cannot ask for it safely.
 *
 * Two things have to be true before a level is sent. The provider has to be one
 * whose vocabulary we know, and the model has to be one we have evidence takes
 * a level at all: either its catalog entry says so, or it is answered by an
 * OpenRouter-shaped endpoint, where a parameter the model does not support is
 * dropped upstream instead of rejected. A direct Anthropic, OpenAI, Google, or
 * xAI key reports no reasoning metadata and rejects a parameter its model does
 * not take, so those keep the provider default until the fallback table in
 * `docs/plans/active/model-request-controls.md` gives us the missing evidence.
 */
export function reasoningProviderOptions({
  effort,
  providerId,
  reasoning,
}: {
  effort: ReasoningEffort;
  /** The AI SDK model's `provider`, such as `openai.responses`. */
  providerId: string;
  /** The model's own reasoning capability, when its provider reported one. */
  reasoning?: AIGatewayModel.Reasoning;
}): SharedV2ProviderOptions | undefined {
  const family = providerId.split(".")[0] ?? "";
  const provider = PROVIDERS[family];
  if (!provider) {
    return undefined;
  }

  if (!reasoning && family !== "openrouter") {
    return undefined;
  }

  const resolved = resolveEffort({
    effort,
    levels: provider.levels,
    reasoning,
  });
  return resolved === undefined ? undefined : provider.options(resolved);
}

function resolveEffort({
  effort,
  levels,
  reasoning,
}: {
  effort: ReasoningEffort;
  levels: Partial<Record<ReasoningEffort, string>>;
  reasoning?: AIGatewayModel.Reasoning;
}) {
  // A model that thinks whether or not we ask cannot be turned off, so asking
  // for none becomes asking for the least thinking it will do.
  if (effort === "none" && reasoning?.mandatory) {
    return REASONING_EFFORTS.map((rung) => levels[rung]).find(
      (word) =>
        word !== undefined && word !== "none" && supports({ reasoning, word }),
    );
  }

  // Only ever step down. Asking for less thinking and being given more is the
  // opposite of the request, so a model that offers nothing at or below the
  // rung we asked for keeps its own default instead.
  const rungs = REASONING_EFFORTS.slice(
    0,
    REASONING_EFFORTS.indexOf(effort) + 1,
  ).reverse();

  return rungs
    .map((rung) => levels[rung])
    .find((word) => word !== undefined && supports({ reasoning, word }));
}

function supports({
  reasoning,
  word,
}: {
  reasoning?: AIGatewayModel.Reasoning;
  word: string;
}) {
  // A capability that names no levels says the model reasons without saying
  // how, which is 141 of the 271 models that report anything at all. The
  // provider's vocabulary is the best answer left.
  if (!reasoning || reasoning.efforts.length === 0) {
    return true;
  }
  return reasoning.efforts.includes(word);
}
