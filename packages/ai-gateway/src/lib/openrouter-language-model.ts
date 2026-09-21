import { type LanguageModelV4 } from "@ai-sdk/provider";
import {
  APP_NAME,
  APP_URL,
  OUR_MODELS,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import {
  defaultSettingsMiddleware,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";

/**
 * Language models for an OpenRouter-shaped config: by model id, either the
 * OpenAI Responses model or `chat`, the OpenRouter provider's own, both
 * reached through the config's gateway URL.
 */
export async function createOpenRouterLanguageModel({
  chat,
  config,
  workspaceServerURL,
}: {
  chat: (modelId: string) => LanguageModelV4;
  config: AIGatewayProviderConfig.Type;
  workspaceServerURL: WorkspaceServerURL;
}): Promise<(modelId: string) => LanguageModelV4> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const openai = createOpenAI({
    apiKey: internalAPIKey(),
    baseURL: internalURL({ config, workspaceServerURL }),
    // The app attribution the OpenRouter provider sends on the chat path.
    headers: { "HTTP-Referer": APP_URL, "X-OpenRouter-Title": APP_NAME },
  });
  const middleware = openRouterResponsesMiddleware(config);
  return (modelId) =>
    isServedThroughResponses(modelId)
      ? wrapLanguageModel({ middleware, model: openai.responses(modelId) })
      : chat(modelId);
}

/**
 * Whether a model behind an OpenRouter-shaped config is asked through
 * OpenRouter's Responses API rather than its Chat Completions API.
 *
 * GPT-5 models write an answer as message items with a `phase`, commentary
 * and then the final answer, and OpenAI says a history that drops the phase
 * degrades them. Chat Completions has one string per reply, so the bridge
 * concatenates the items with a blank line and the phase is gone; on a turn
 * whose commentary and final answer are the same words, the reply arrives as
 * that line said twice. The Responses API carries each item with its phase.
 *
 * Only OpenAI's models and our own aliases go this way: the aliases resolve
 * server-side to an OpenAI model today, and OpenRouter answers any model in
 * this shape should that change. Every other vendor stays on Chat Completions,
 * where the OpenRouter provider carries that vendor's reasoning fixes.
 */
export function isServedThroughResponses(modelId: string): boolean {
  return (
    modelId.startsWith("openai/") || modelId.startsWith(`${OUR_MODELS.prefix}/`)
  );
}

/**
 * The provider options every request through OpenRouter's Responses API has
 * to carry, put on the model so no caller can leave them off.
 *
 * `store: false` because OpenRouter keeps nothing between requests: with
 * storage on, the SDK replays an earlier reply as a reference to its item id,
 * which nothing upstream can resolve. `user` is the same for every request
 * under a config, the way the Chat Completions path already sends it, so
 * OpenRouter's caching stays consistent across turns. A caller's own
 * `openai` options still win over either.
 */
export function openRouterResponsesMiddleware(
  config: AIGatewayProviderConfig.Type,
): LanguageModelMiddleware {
  const user =
    config.type === "openrouter" ? config.cacheIdentifier : undefined;
  return defaultSettingsMiddleware({
    settings: {
      providerOptions: {
        openai: { store: false, ...(user === undefined ? {} : { user }) },
      },
    },
  });
}
