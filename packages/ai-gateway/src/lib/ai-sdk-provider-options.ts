import { type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { type SharedV2ProviderOptions } from "@ai-sdk/provider";
import { type LanguageModel } from "ai";

import { type AIGatewayModel } from "../schemas/model";
import {
  type ReasoningEffort,
  reasoningProviderOptions,
} from "./reasoning-effort";

/**
 * The reasoning models that accept `reasoning.encrypted_content`: gpt-5 and
 * every later generation, and the o-series (`o3`, `o4-mini`). With `store:
 * false`, the encrypted item is the only way a turn's reasoning reaches the
 * next one; a model left out of this list re-derives its plan every step.
 */
const ENCRYPTED_REASONING_MODEL_ID = /^(?:gpt-(?:[5-9]|\d{2,})|o\d)/;

export function providerOptionsForModel(
  model: LanguageModel,
  {
    effort,
    reasoning,
  }: {
    /**
     * How hard to ask this model to think. Omitted leaves the provider's own
     * default standing, which is what an agent turn wants and what every
     * caller did before there was a way to say otherwise.
     */
    effort?: ReasoningEffort;
    /** The model's reasoning capability, from its catalog entry. */
    reasoning?: AIGatewayModel.Reasoning;
  } = {},
): SharedV2ProviderOptions {
  const result: SharedV2ProviderOptions = {};

  if (
    typeof model !== "string" &&
    model.provider === "openai.responses" &&
    ENCRYPTED_REASONING_MODEL_ID.test(model.modelId)
  ) {
    result.openai = {
      include: ["reasoning.encrypted_content"],
      store: false,
    } satisfies OpenAIResponsesProviderOptions;
  }

  if (typeof model !== "string" && model.provider === "xai.responses") {
    // xAI's Responses API keeps every response on its servers unless told
    // not to. Off, as for OpenAI above, which also has the provider ask for
    // reasoning back as encrypted content that is stored with the turn and
    // replayed.
    result.xai = { store: false };
  }

  if (effort && typeof model !== "string") {
    const asked = reasoningProviderOptions({
      effort,
      providerId: model.provider,
      reasoning,
    });
    for (const [provider, options] of Object.entries(asked ?? {})) {
      result[provider] = { ...result[provider], ...options };
    }
  }

  if (
    typeof model !== "string" &&
    model.provider === "openai.responses" &&
    model.modelId.includes("/") &&
    reasoning
  ) {
    // A vendor prefix on the id means OpenRouter is answering in OpenAI's
    // shape. The SDK reads reasoning support off the bare id, so it is told
    // outright when the catalog says the model reasons; with the `store:
    // false` the model's middleware sets, that also has it ask for reasoning
    // back encrypted. Summaries are what the Chat Completions path showed as
    // the model's thinking, so they stay on even when an effort is set.
    result.openai = {
      ...result.openai,
      forceReasoning: true,
      reasoningSummary: "auto",
    } satisfies OpenAIResponsesProviderOptions;
  }

  return result;
}
