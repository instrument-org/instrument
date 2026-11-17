import { type LanguageModelV4 } from "@ai-sdk/provider";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { Result } from "typescript-result";

import {
  type AIGatewayProviderConfig,
  TEST_MODEL_OVERRIDE_KEY,
} from "../schemas/provider-config";
import {
  createOpenAISDK,
  createOpenRouterSDK,
} from "./ai-sdk-for-provider-config";
import { TypedError } from "./errors";
import { chatGPTAccountFastModel } from "./fetch-models/chatgpt";
import { type ModelCache } from "./model-cache";
export { hasFastModel } from "./fast-model-kinds";
import { reasoningProviderOptions } from "./reasoning-effort";

/**
 * The model a side call on an Instrument account asks for: Instrument's fast
 * model. Auto stands in until the API declares a dedicated one, which only
 * this line changes.
 */
export const INSTRUMENT_FAST_MODEL = OUR_MODELS.text.id;

/**
 * Claude Code's alias for its newest Haiku, which the CLI resolves itself,
 * so a newer Haiku is used the day the plan offers it.
 */
const CLAUDE_FAST_ALIAS = "haiku";

export interface AISDKFastModel {
  model: LanguageModelV4;
  /** The model as asked for, alias or id, for the record. */
  modelId: string;
  /** The least thinking the provider allows, when it takes a level at all. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * The fast model on `config`, at the lowest effort its provider accepts:
 * the newest Haiku on a Claude account, the newest Luna on a ChatGPT account,
 * and {@link INSTRUMENT_FAST_MODEL} on Instrument. Any other connection has
 * none.
 */
export async function getAISDKFastModel({
  config,
  modelCache,
  workspaceServerURL,
}: {
  config: AIGatewayProviderConfig.Type;
  modelCache?: ModelCache;
  workspaceServerURL: WorkspaceServerURL;
}): Promise<Result<AISDKFastModel, TypedError.NotFound>> {
  const testOverride = (
    config as { [TEST_MODEL_OVERRIDE_KEY]?: LanguageModelV4 }
  )[TEST_MODEL_OVERRIDE_KEY];
  if (testOverride) {
    return Result.ok({ model: testOverride, modelId: testOverride.modelId });
  }
  const listed = modelCache?.read(config.cacheIdentifier) ?? [];
  switch (config.type) {
    case "claude-account": {
      if (!config.executablePath) {
        return Result.error(
          new TypedError.NotFound(
            "The Claude account has no Claude Code to run.",
          ),
        );
      }
      const { createClaudeAccountLanguageModel } =
        await import("./providers/claude-account/language-model");
      const haiku = listed
        .filter((model) => model.canonicalId.startsWith("claude-haiku-"))
        .toSorted((a, b) => b.canonicalId.localeCompare(a.canonicalId))[0];
      return Result.ok({
        model: createClaudeAccountLanguageModel({
          configDir: config.configDir,
          executablePath: config.executablePath,
          providerConfigId: config.id,
        })(CLAUDE_FAST_ALIAS),
        modelId: CLAUDE_FAST_ALIAS,
        // Claude Code stops at low; a Haiku the catalog says takes no level
        // runs at its own default.
        providerOptions: haiku?.reasoning
          ? reasoningProviderOptions({
              effort: "low",
              providerId: "claude-account",
              reasoning: haiku.reasoning,
            })
          : undefined,
      });
    }
    case "chatgpt-account": {
      const luna = chatGPTAccountFastModel(listed);
      if (!luna) {
        return Result.error(
          new TypedError.NotFound("The ChatGPT account lists no fast model."),
        );
      }
      const sdk = await createOpenAISDK(config, workspaceServerURL);
      return Result.ok({
        model: sdk(luna.providerId),
        modelId: luna.providerId,
        // The lowest the plan accepts, as a web search on it asks.
        providerOptions: {
          openai: { reasoningEffort: "none", reasoningSummary: null },
        },
      });
    }
    case OUR_MODELS.providerType: {
      const sdk = await createOpenRouterSDK(config, workspaceServerURL);
      return Result.ok({
        model: sdk(INSTRUMENT_FAST_MODEL),
        modelId: INSTRUMENT_FAST_MODEL,
        providerOptions: reasoningProviderOptions({
          effort: "none",
          providerId: "openrouter",
        }),
      });
    }
    default: {
      return Result.error(
        new TypedError.NotFound(
          `A ${config.type} connection has no fast model for side calls.`,
        ),
      );
    }
  }
}
