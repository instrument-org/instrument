import { describe, expect, it } from "vitest";

import { type AIGatewayModel } from "../schemas/model";
import {
  type ReasoningEffort,
  reasoningProviderOptions,
} from "./reasoning-effort";

function capability(
  overrides: Partial<AIGatewayModel.Reasoning> = {},
): AIGatewayModel.Reasoning {
  return {
    efforts: [],
    enabledByDefault: true,
    mandatory: false,
    ...overrides,
  };
}

/** What the catalog says about the model behind the auto setting. */
const luna = capability({
  defaultEffort: "medium",
  efforts: ["max", "xhigh", "high", "medium", "low", "none"],
});

describe("reasoningProviderOptions", () => {
  it.each<
    [
      string,
      string,
      ReasoningEffort,
      AIGatewayModel.Reasoning | undefined,
      unknown,
    ]
  >([
    [
      "asks an OpenRouter-shaped endpoint even with no metadata, because an unsupported parameter is dropped upstream rather than rejected",
      "openrouter",
      "low",
      undefined,
      { openrouter: { reasoning: { effort: "low" } } },
    ],
    [
      "asks for the rung the model lists",
      "openrouter",
      "low",
      luna,
      { openrouter: { reasoning: { effort: "low" } } },
    ],
    [
      "spends our top rung on the highest word the provider takes, not the highest the model lists",
      "openrouter",
      "max",
      luna,
      { openrouter: { reasoning: { effort: "xhigh" } } },
    ],
    [
      "leaves the model's own default standing rather than stepping up past what was asked for",
      "openrouter",
      "medium",
      capability({ efforts: ["high"] }),
      undefined,
    ],
    [
      "cannot turn off a model that thinks whether or not we ask, so none becomes the least it will do",
      "openrouter",
      "none",
      capability({ efforts: ["high", "medium", "low"], mandatory: true }),
      { openrouter: { reasoning: { effort: "low" } } },
    ],
    [
      "says nothing to a direct key that reports no reasoning metadata, where an unsupported parameter is a rejected request",
      "anthropic.messages",
      "low",
      undefined,
      undefined,
    ],
    [
      "asks a direct key once its model carries a capability",
      "anthropic.messages",
      "low",
      capability(),
      { anthropic: { effort: "low" } },
    ],
    [
      "steps down to the nearest rung a two-level provider offers",
      "xai",
      "medium",
      capability(),
      { xai: { reasoningEffort: "low" } },
    ],
    [
      "spends none on the lowest thinking a provider that cannot stop offers",
      "google.generative-ai",
      "none",
      capability(),
      { google: { thinkingConfig: { thinkingLevel: "minimal" } } },
    ],
    [
      "reads the family out of the provider id, so chat and responses share one entry",
      "openai.responses",
      "max",
      capability(),
      { openai: { reasoningEffort: "xhigh" } },
    ],
    [
      "says nothing to a provider whose vocabulary we have not written down",
      "deepseek.chat",
      "low",
      capability(),
      undefined,
    ],
    [
      "asks an OpenAI-compatible endpoint in the namespace that SDK reads, which is not the one named for the family",
      "openai-compatible.chat",
      "low",
      capability({ efforts: ["low", "medium"] }),
      { openaiCompatible: { reasoningEffort: "low" } },
    ],
    [
      "steps an OpenAI-compatible model down to the highest rung it lists, rather than sending a word it would answer 400 to",
      "openai-compatible.chat",
      "max",
      capability({ efforts: ["low", "medium"] }),
      { openaiCompatible: { reasoningEffort: "medium" } },
    ],
    [
      "never asks an OpenAI-compatible endpoint for xhigh, which is OpenAI's word and not shared by the endpoints behind this type",
      "openai-compatible.chat",
      "max",
      capability(),
      { openaiCompatible: { reasoningEffort: "high" } },
    ],
    [
      "still says nothing to an OpenAI-compatible model whose catalog entry does not claim reasoning at all",
      "openai-compatible.chat",
      "low",
      undefined,
      undefined,
    ],
  ])("%s", (_name, providerId, effort, reasoning, expected) => {
    expect(reasoningProviderOptions({ effort, providerId, reasoning })).toEqual(
      expected,
    );
  });
});
