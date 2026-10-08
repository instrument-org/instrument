/**
 * What the own-key pages show about a provider and its models: the providers
 * offered first, the three models put forward on "Pick your main model", and
 * the masked key. Pure, so the picks can be checked against real model lists.
 */

import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { type AIProviderType } from "@instrument-org/shared";

/** The providers most people have keys for, in the order the grid shows them. */
export const KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
] satisfies AIProviderType[];

type Tier = "everyday" | "fast" | "strong";

/**
 * What a model's id says about where it sits in its maker's lineup. Every
 * description holds for any release of the line it names, so a new release
 * keeps a true one. First match wins, which is why Flash-Lite comes before
 * Flash.
 */
const TIERS: { detail: string; pattern: RegExp; tier: Tier }[] = [
  {
    detail: "Best for hard problems. Slower, and costs more.",
    pattern: /(?:^|-)opus-|-pro(?:-|$)/,
    tier: "strong",
  },
  {
    detail: "Thinks before it answers, so it's slower.",
    pattern: /^deepseek-reasoner$/,
    tier: "strong",
  },
  {
    detail: "Fastest, and costs the least.",
    pattern: /(?:^|-)haiku-|-flash-lite(?:-|$)|-nano(?:-|$)/,
    tier: "fast",
  },
  {
    detail: "Faster, and costs less.",
    pattern: /-mini(?:-|$)/,
    tier: "fast",
  },
  {
    detail: "Quick and capable. Good for most work.",
    pattern: /(?:^|-)sonnet-|-flash(?:-|$)|^deepseek-chat$/,
    tier: "everyday",
  },
];

/** Models that are not for chatting: speech, pictures, embeddings. */
const NOT_FOR_CHAT =
  /-(?:audio|embedding|image|imagine|live|transcribe|tts|video|vision|voice)(?:[-.]|$)/;

export type ModelPick = {
  detail: string | undefined;
  model: AIGatewayModel.Type;
  recommended: boolean;
};

function tierOf(model: AIGatewayModel.Type) {
  return TIERS.find(({ pattern }) => pattern.test(model.canonicalId));
}

function versionOf(model: AIGatewayModel.Type): number {
  const match = /(\d+(?:\.\d+)?)/.exec(model.canonicalId);
  return match?.[1] ? Number.parseFloat(match[1]) : 0;
}

/** Recommended first, then the newest release, then the plainest id. */
function compareModels(a: AIGatewayModel.Type, b: AIGatewayModel.Type) {
  const recommended =
    Number(b.tags.includes("recommended")) -
    Number(a.tags.includes("recommended"));
  if (recommended !== 0) {
    return recommended;
  }
  const version = versionOf(b) - versionOf(a);
  if (version !== 0) {
    return version;
  }
  return a.canonicalId.length - b.canonicalId.length;
}

/**
 * The three models "Pick your main model" puts forward: the provider's
 * everyday model, marked Recommended, then its strongest and its fastest when
 * the list has them, then whatever else it recommends.
 */
export function pickMainModels(models: AIGatewayModel.Type[]): ModelPick[] {
  const usable = models
    .filter(
      (model) =>
        !model.restricted &&
        !model.tags.includes("legacy") &&
        !NOT_FOR_CHAT.test(model.canonicalId),
    )
    .toSorted(compareModels);

  const chosen: AIGatewayModel.Type[] = [];
  const best = (predicate: (model: AIGatewayModel.Type) => boolean) =>
    usable.find((model) => !chosen.includes(model) && predicate(model));

  const primary =
    best((model) => model.tags.includes("default")) ??
    best((model) => tierOf(model)?.tier === "everyday") ??
    usable[0];
  if (!primary) {
    return [];
  }
  chosen.push(primary);

  for (const tier of ["strong", "fast"] satisfies Tier[]) {
    const model = best((candidate) => tierOf(candidate)?.tier === tier);
    if (model) {
      chosen.push(model);
    }
  }
  while (chosen.length < 3) {
    const model =
      best((candidate) => candidate.tags.includes("recommended")) ??
      best(() => true);
    if (!model) {
      break;
    }
    chosen.push(model);
  }

  return chosen.map((model) => ({
    detail:
      tierOf(model)?.detail ??
      (model === primary ? "Good for most work." : undefined),
    model,
    recommended: model === primary,
  }));
}

/** A key with only its start and its last few characters showing. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) {
    return "•".repeat(trimmed.length);
  }
  const start = trimmed.slice(0, Math.min(13, Math.floor(trimmed.length / 3)));
  return `${start}${"•".repeat(16)}${trimmed.slice(-3)}`;
}
