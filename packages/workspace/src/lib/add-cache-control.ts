import type { AIGatewayModel } from "@instrument-org/ai-gateway";
import type { ModelMessage } from "ai";

import { unique } from "radashi";

import { isAnthropic } from "./is-anthropic";

// Apply cache control for Anthropic models
// Read https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
// to understand why we're placing the cache control options the way we are
// Adapted from
// https://github.com/sst/opencode/blob/dev/packages/opencode/src/provider/transform.ts
//
// The gate is the model, not the provider: the four dialects below are the
// spellings an Anthropic model takes when reached through each of those
// providers, not support for four providers' models. Every other model gets
// whatever prefix caching its provider does on its own, and a marker sent
// anyway is accepted and ignored where it was measured (Workers AI, GLM; see
// docs/findings/non-anthropic-models-get-no-cache-breakpoints.md).
export function addCacheControlToMessages({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model: AIGatewayModel.Type;
}) {
  if (isAnthropic(model)) {
    const system = messages
      .filter((message) => message.role === "system")
      .slice(0, 2);
    const final = messages
      .filter((message) => message.role !== "system")
      .slice(-2);

    const providerOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      bedrock: {
        cachePoint: { type: "ephemeral" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
      openrouter: {
        cache_control: { type: "ephemeral" },
      },
    };

    for (const message of unique([...system, ...final])) {
      const shouldUseContentOptions =
        model.params.provider !== "anthropic" &&
        Array.isArray(message.content) &&
        message.content.length > 0;

      if (shouldUseContentOptions) {
        const lastContent = message.content.at(-1);
        if (
          lastContent &&
          typeof lastContent === "object" &&
          "type" in lastContent &&
          lastContent.type !== "tool-approval-request" &&
          lastContent.type !== "tool-approval-response"
        ) {
          lastContent.providerOptions = {
            ...lastContent.providerOptions,
            ...providerOptions,
          };
          continue;
        }
      }

      message.providerOptions = {
        ...message.providerOptions,
        ...providerOptions,
      };
    }
  }
  return messages;
}
