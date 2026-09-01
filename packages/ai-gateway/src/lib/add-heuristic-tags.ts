import { OUR_MODELS } from "@instrument-org/shared";
import { unique } from "radashi";

import { type AIGatewayModel } from "../schemas/model";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";

const MODEL_TAGS: Record<string, AIGatewayModel.ModelTag[]> = {
  "claude-sonnet-5": ["default"],
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
 * A weight count spelled into the id, in billions or trillions and with the
 * active count of a sparse model beside it: `qwen3.8-27b`,
 * `qwen3.8-2.4t-a95b`, `llama-3.3-70b-instruct`.
 *
 * An author who publishes weights publishes several sizes of one release, and
 * which size to run is a judgment about the machine serving it rather than
 * about the model. So these stay in the picker and out of the recommendations,
 * where the hosted build of the same release already speaks for the line.
 */
const NAMES_A_WEIGHT_COUNT = /(?:^|-)a?\d+(?:\.\d+)?[bt](?:[-:]|$)/;

/**
 * Tags one model from its id alone, which is as far as a single model can be
 * judged: whether this app can drive a coding turn with it, and whether its
 * release is recent enough to be worth recommending at all.
 *
 * Which release of a line is the current one is a question about the rest of
 * the list, so it is answered where the list is whole:
 * `demoteVariantsOfListedModels` takes `recommended` off a Pro or Fast variant
 * of something already listed, and `demoteSupersededModels` takes it off a
 * release its author has replaced.
 */
export function addHeuristicTags(
  model: AIGatewayModel.Type,
  config: AIGatewayProviderConfig.Type,
): AIGatewayModel.Type {
  const { author, canonicalId } = model;
  const staticTags = MODEL_TAGS[canonicalId] ?? [];
  const namesAWeightCount = NAMES_A_WEIGHT_COUNT.test(canonicalId);
  const dynamicTags = getDynamicTags(canonicalId).filter(
    (tag) => !(namesAWeightCount && tag === "recommended"),
  );

  let tags = [...model.tags, ...dynamicTags, ...staticTags];

  if (isLegacy(canonicalId)) {
    tags = [...tags.filter((tag) => tag !== "recommended"), "legacy"];
  }

  if (canonicalId.startsWith("o-") && config.type === "openai") {
    tags.push("legacy");
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
    if (canonicalId.includes("nano")) {
      return ["coding"];
    }

    if (matchesVersionFloor(canonicalId, "gpt-", 5.5)) {
      return ["coding", "recommended"];
    }
    return matchesVersionFloor(canonicalId, "gpt-", 5) ? ["coding"] : [];
  }

  // Anthropic's lineup is Fable 5, Opus 5, and Sonnet 5; every other Claude is
  // one Anthropic itself files under legacy. Haiku sits a generation back at
  // 4.5, so it clears the floor only once a Haiku 5 ships.
  if (
    canonicalId.startsWith("claude-sonnet-") ||
    canonicalId.startsWith("claude-haiku-") ||
    canonicalId.startsWith("claude-opus-") ||
    canonicalId.startsWith("claude-fable-")
  ) {
    if (
      matchesVersionFloor(canonicalId, "claude-sonnet-", 5) ||
      matchesVersionFloor(canonicalId, "claude-haiku-", 5) ||
      matchesVersionFloor(canonicalId, "claude-opus-", 5) ||
      matchesVersionFloor(canonicalId, "claude-fable-", 5)
    ) {
      return ["coding", "recommended"];
    }
    return ["coding"];
  }

  if (matchesVersionFloor(canonicalId, "gemini-", 3)) {
    return ["coding", "recommended"];
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
