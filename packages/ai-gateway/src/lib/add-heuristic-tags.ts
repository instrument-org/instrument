import { OUR_MODELS } from "@instrument-org/shared";
import { unique } from "radashi";

import { type AIGatewayModel } from "../schemas/model";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";

const MODEL_TAGS: Record<string, AIGatewayModel.ModelTag[]> = {
  "claude-sonnet-5": ["default"],
  "grok-build-0.1": ["coding", "recommended"],
};

// Models that we normally wouldn't set as default, but we for the author
const DEFAULT_MODELS_BY_CONFIG_TYPE: Partial<
  Record<AIGatewayProviderConfig.Type["type"], string[]>
> = {
  anthropic: ["claude-sonnet-5"],
  cerebras: ["gpt-oss-120b"],
  google: ["gemini-3.7-flash"],
  groq: ["gpt-oss-120b"],
  openai: ["gpt-5.6-terra"],
  "x-ai": ["grok-4.6"],
  "z-ai": ["glm-5.3"],
};

/**
 * Suffixes that name a modality this app cannot drive a coding turn with, even
 * when the model behind them answers tool calls. Matched anywhere in the id so
 * that both a family suffix (`gemini-3-pro-image`) and an infix
 * (`gemini-3.1-flash-live-preview`) are caught.
 */
const NON_CODING_MODALITY =
  /-(?:audio|image|imagine|live|transcribe|tts|video|vision|voice)(?:[-.]|$)/;

/**
 * OpenAI's Pro tiers, whether a separate model (GPT-5.5 Pro asks $30/$180
 * against GPT-5.5's $5/$30) or a reasoning mode on top of one. Nobody reads a
 * price list before picking from a list headed "Recommended", and the depth
 * Pro buys is worth less here than it is on a one-shot question, so Pro stays
 * pickable without ever being put forward. `-pro(-|$)` so that `-preview` is
 * left alone.
 */
const OPENAI_PRO_TIER = /-pro(?:-|$)/;

export function addHeuristicTags(
  model: AIGatewayModel.Type,
  config: AIGatewayProviderConfig.Type,
): AIGatewayModel.Type {
  const { author, canonicalId } = model;
  const staticTags = MODEL_TAGS[canonicalId] ?? [];
  const dynamicTags = getDynamicTags(canonicalId);

  let tags = [...model.tags, ...dynamicTags, ...staticTags];

  if (isLegacy(canonicalId)) {
    tags = [...tags.filter((tag) => tag !== "recommended"), "legacy"];
  }

  if (canonicalId.startsWith("o-") && config.type === "openai") {
    tags.push("legacy");
  }

  // A priority tier is the same weights as the sibling it is named after, at
  // two to three times the price. Listing one beside its base model offers a
  // worse deal as an equal.
  if (canonicalId.endsWith("-fast")) {
    tags = tags.filter((tag) => tag !== "recommended" && tag !== "default");
  }

  if (
    (config.type === "openai" || config.type === "openai-compatible") &&
    canonicalId.endsWith("-codex")
  ) {
    tags = tags.filter((tag) => tag !== "recommended" && tag !== "default");
  }

  const defaultModels = DEFAULT_MODELS_BY_CONFIG_TYPE[config.type] ?? [];
  if (defaultModels.includes(canonicalId)) {
    tags.push("default");
  }

  if (author === OUR_MODELS.author) {
    tags = [...tags, "recommended", "coding"];
    if (model.providerId === OUR_MODELS.text.id) {
      tags.push("default");
    }
  }

  return {
    ...model,
    tags: unique(tags),
  };
}

function getDynamicTags(
  canonicalId: AIGatewayModel.CanonicalId,
): AIGatewayModel.ModelTag[] {
  if (NON_CODING_MODALITY.test(canonicalId)) {
    return [];
  }

  if (canonicalId.startsWith("gpt-")) {
    if (OPENAI_PRO_TIER.test(canonicalId) || canonicalId.includes("nano")) {
      return ["coding"];
    }

    if (matchesVersionFloor(canonicalId, "gpt-", 5.5)) {
      return ["coding", "recommended"];
    }
    return matchesVersionFloor(canonicalId, "gpt-", 5) ? ["coding"] : [];
  }

  // Anthropic's lineup is Fable 5, Opus 5, Sonnet 5, and Haiku 4.5; every other
  // Claude is one Anthropic itself files under legacy.
  if (
    canonicalId.startsWith("claude-sonnet-") ||
    canonicalId.startsWith("claude-haiku-") ||
    canonicalId.startsWith("claude-opus-") ||
    canonicalId.startsWith("claude-fable-")
  ) {
    if (
      matchesVersionFloor(canonicalId, "claude-sonnet-", 5) ||
      matchesVersionFloor(canonicalId, "claude-haiku-", 4.5) ||
      matchesVersionFloor(canonicalId, "claude-opus-", 5) ||
      matchesVersionFloor(canonicalId, "claude-fable-", 5)
    ) {
      return ["coding", "recommended"];
    }
    return ["coding"];
  }

  // Gemini's Pro line stops at 3.1 while Flash has run on to 3.7, so the floor
  // has to sit below the newest release or the only Pro on offer drops out.
  if (matchesVersionFloor(canonicalId, "gemini-", 3.1)) {
    return ["coding", "recommended"];
  }
  if (matchesVersionFloor(canonicalId, "gemini-", 3)) {
    return ["coding"];
  }

  if (matchesVersionFloor(canonicalId, "grok-", 4.5)) {
    return ["coding", "recommended"];
  }

  if (matchesVersionFloor(canonicalId, "glm-", 5.2)) {
    return ["coding", "recommended"];
  }

  if (matchesVersionFloor(canonicalId, "kimi-k", 2.6)) {
    return ["coding", "recommended"];
  }

  if (matchesVersionFloor(canonicalId, "minimax-m", 3)) {
    return ["coding", "recommended"];
  }

  // Qwen folded its coder line into the numbered releases, so the floor reads
  // the release rather than a `-coder` suffix that no longer ships.
  if (matchesVersionFloor(canonicalId, "qwen", 3.7)) {
    return ["coding", "recommended"];
  }

  if (matchesVersionFloor(canonicalId, "deepseek-v", 4)) {
    return ["coding", "recommended"];
  }

  return [];
}

function isLegacy(canonicalId: AIGatewayModel.CanonicalId): boolean {
  if (canonicalId.startsWith("claude-3")) {
    return true;
  }

  if (
    canonicalId.startsWith("claude-sonnet-4") ||
    canonicalId.startsWith("claude-opus-4")
  ) {
    return true;
  }

  if (
    canonicalId.startsWith("claude-haiku-") &&
    !matchesVersionFloor(canonicalId, "claude-haiku-", 4.5)
  ) {
    return true;
  }

  if (
    /^gemini-\d/.test(canonicalId) &&
    !matchesVersionFloor(canonicalId, "gemini-", 3)
  ) {
    return true;
  }

  if (/^gpt-[34]/.test(canonicalId)) {
    return true;
  }

  // GPT-5.4 unified the Codex and GPT lines, which retired everything below it
  // including the separate `-codex` builds.
  if (
    matchesVersionFloor(canonicalId, "gpt-", 5) &&
    !matchesVersionFloor(canonicalId, "gpt-", 5.4)
  ) {
    return true;
  }

  return false;
}

function matchesVersionFloor(
  modelId: string,
  prefix: string,
  floorVersion: number,
): boolean {
  if (!modelId.startsWith(prefix)) {
    return false;
  }

  const versionPart = modelId.slice(prefix.length);
  const versionMatch = /^(\d+(?:\.\d+)?)/.exec(versionPart);

  if (!versionMatch?.[1]) {
    return false;
  }

  // A letter straight after the digits belongs to the name, not the version:
  // `glm-5v-turbo` is a vision model, not GLM 5.
  if (/^[a-z]/i.test(versionPart.slice(versionMatch[1].length))) {
    return false;
  }

  const version = Number.parseFloat(versionMatch[1]);
  return version >= floorVersion;
}
