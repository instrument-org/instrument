import {
  type LanguageModelV4,
  type SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { type ToolSet } from "ai";
import { Result } from "typescript-result";

import { type AIGatewayModel } from "../schemas/model";
import {
  type AIGatewayProviderConfig,
  TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY,
} from "../schemas/provider-config";
import {
  createAnthropicSDK,
  createGoogleSDK,
  createOpenAISDK,
  createOpenRouterSDK,
  createVercelSDK,
  createXAISDK,
} from "./ai-sdk-for-provider-config";
import { TypedError } from "./errors";
import { chatGPTAccountSearchModel } from "./fetch-models/chatgpt";
import { type ModelCache } from "./model-cache";
import {
  filterWebSearchConfigs,
  type WebSearchProviderType,
} from "./providers/metadata";
import { selectProviderConfigs } from "./select-provider-configs";

const PROVIDER_TYPE_PRIORITY: WebSearchProviderType[] = [
  // Ordered by quality/reliability as of 2026-02-06
  OUR_MODELS.providerType,
  "openrouter",
  "openai",
  "google",
  "anthropic",
  "x-ai",
  "vercel",
  // Last, so a search from a chat on another provider spends the user's
  // plan only when nothing else can search.
  "chatgpt-account",
  "grok-account",
  "claude-account",
];

export interface AISDKWebSearchModelResult {
  model: LanguageModelV4;
  providerOptions?: SharedV4ProviderOptions;
  tools?: ToolSet;
}

export async function getAISDKWebSearchModel({
  callingModel,
  config,
  modelCache,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  config: AIGatewayProviderConfig.Type & { type: WebSearchProviderType };
  /** Where a provider's listed models are read from, for picking one by tier. */
  modelCache?: ModelCache;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const testOverride = (
    config as {
      [TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY]?: AISDKWebSearchModelResult;
    }
  )[TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY];
  if (testOverride) {
    return Result.ok(testOverride);
  }

  let result: AISDKWebSearchModelResult | undefined;
  const isCallingModelSameProvider =
    callingModel.params.provider === config.type;

  switch (config.type) {
    case "anthropic": {
      const sdk = await createAnthropicSDK(config, workspaceServerURL);
      result = {
        model: isCallingModelSameProvider
          ? sdk(callingModel.providerId)
          : sdk("claude-sonnet-5"),
        tools: {
          web_search: sdk.tools.webSearch_20250305({ maxUses: 2 }),
        },
      };
      break;
    }
    case "chatgpt-account": {
      const sdk = await createOpenAISDK(config, workspaceServerURL);
      // Always the plan's lightest model, not thinking and reading little: a
      // search is a lookup, and on the plan every search model's own
      // searching counts against the user's limits and takes minutes at the
      // chat model's depth. `none` is the lowest effort the plan accepts
      // alongside web search (`minimal` is refused); the short reply the
      // search prompt asks for is what most of the speed comes from, and
      // `none` takes a little more off.
      result = {
        model: sdk(
          // The account's own catalog decides, so a newer Luna is used the
          // day the plan lists it. The chat's model stands in only when the
          // catalog was never read.
          chatGPTAccountSearchModel(
            modelCache?.read(config.cacheIdentifier) ?? [],
          )?.providerId ?? callingModel.providerId,
        ),
        providerOptions: {
          openai: { reasoningEffort: "none" },
        },
        tools: {
          web_search: sdk.tools.webSearch({ searchContextSize: "low" }),
        },
      };
      break;
    }
    case "claude-account": {
      // The chat's own model, searching with Claude Code's WebSearch, which
      // runs on Anthropic's side and draws on the same subscription. Only a
      // chat on the account searches here: a Claude account is never another
      // provider's fallback.
      if (!config.executablePath) {
        return Result.error(
          new TypedError.NotFound(
            "The Claude account has no Claude Code to run.",
          ),
        );
      }
      const { createClaudeAccountLanguageModel } =
        await import("./providers/claude-account/language-model");
      result = {
        model: createClaudeAccountLanguageModel({
          configDir: config.configDir,
          executablePath: config.executablePath,
          providerConfigId: config.id,
        })(callingModel.providerId),
        providerOptions: {
          "claude-account": { builtInTools: ["WebSearch"] },
        },
      };
      break;
    }
    case "google": {
      const sdk = await createGoogleSDK(config, workspaceServerURL);
      result = {
        model: sdk("gemini-3.7-flash"),
        tools: {
          web_search: sdk.tools.googleSearch({}),
        },
      };
      break;
    }
    case "grok-account": {
      // The subscription's token reaches xAI's hosted search over X as well
      // as the web, so a search on the account can read posts too.
      const sdk = await createXAISDK(config, workspaceServerURL);
      result = {
        model: sdk.responses(
          isCallingModelSameProvider
            ? callingModel.providerId
            : lookupGrokModel(config, modelCache),
        ),
        tools: {
          web_search: sdk.tools.webSearch(),
          x_search: sdk.tools.xSearch(),
        },
      };
      break;
    }
    case "openai": {
      const sdk = await createOpenAISDK(config, workspaceServerURL);
      result = {
        model: isCallingModelSameProvider
          ? sdk(callingModel.providerId)
          : sdk("gpt-6-luna"),
        tools: {
          web_search: sdk.tools.webSearch(),
        },
      };
      break;
    }
    case "openrouter":
    case OUR_MODELS.providerType: {
      const sdk = await createOpenRouterSDK(config, workspaceServerURL);
      result = {
        model: isCallingModelSameProvider
          ? sdk(callingModel.providerId)
          : config.type === "openrouter"
            ? sdk("openrouter/auto")
            : sdk(OUR_MODELS.text.id),
        providerOptions: {
          openrouter: {
            // Let OpenRouter decide native vs Exa-powered
            plugins: [{ id: "web" }],
          },
        },
      };
      break;
    }
    case "vercel": {
      const sdk = createVercelSDK(config, workspaceServerURL);
      result = {
        model: isCallingModelSameProvider
          ? sdk(callingModel.providerId)
          : sdk("anthropic/claude-sonnet-5"),
        tools: {
          perplexity_search: sdk.tools.perplexitySearch(),
        },
      };
      break;
    }
    case "x-ai": {
      const sdk = await createXAISDK(config, workspaceServerURL);
      result = {
        model: isCallingModelSameProvider
          ? sdk.responses(callingModel.providerId)
          : sdk.responses("grok-4.6"),
        tools: {
          web_search: sdk.tools.webSearch(),
        },
      };
      break;
    }
    default: {
      const _exhaustiveCheck: never = config.type;
      return Result.error(
        new TypedError.NotFound(
          `Unhandled provider type: ${JSON.stringify(_exhaustiveCheck)}`,
        ),
      );
    }
  }

  return Result.ok({ ...result, config });
}

/**
 * The hosted search tools a chat model on this connection runs inside its own
 * step, in place of the `web_search` tool's separate search model. Undefined
 * for a connection whose models search only through that tool.
 *
 * A Grok account's model searches the web and X on xAI's side and answers in
 * the same response, so the search costs no second request against the plan.
 */
export async function nativeSearchTools(
  providerType: AIGatewayProviderConfig.Type["type"],
): Promise<ToolSet | undefined> {
  if (providerType !== "grok-account") {
    return undefined;
  }
  const { xaiTools } = await import("@ai-sdk/xai");
  return {
    web_search: xaiTools.webSearch(),
    x_search: xaiTools.xSearch(),
  };
}

export type XSearchOptions = NonNullable<
  Parameters<typeof import("@ai-sdk/xai").xaiTools.xSearch>[0]
>;

/**
 * xAI's alias for its newest non-reasoning Grok, for an account whose catalog
 * was never read.
 */
const X_SEARCH_FALLBACK_MODEL = "grok-4.20-non-reasoning";

/**
 * A model that searches posts on X with xAI's hosted `x_search`, on the
 * signed-in Grok account whatever model the chat runs on: X search is the
 * subscription's to give, so no other connection stands in for it.
 */
export async function getXSearchModel({
  configs,
  modelCache,
  options,
  workspaceServerURL,
}: {
  configs: AIGatewayProviderConfig.Type[];
  modelCache?: ModelCache;
  /**
   * xAI's own: handles without the `@` (allowed or excluded, never both),
   * `fromDate` inclusive and `toDate` exclusive as `YYYY-MM-DD`, and whether
   * Grok looks at the images and video in posts.
   */
  options: XSearchOptions;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const config = configs.find((candidate) => candidate.type === "grok-account");
  if (!config) {
    return Result.error(
      new TypedError.NotFound("No Grok account is signed in."),
    );
  }
  const sdk = await createXAISDK(config, workspaceServerURL);
  return Result.ok({
    config,
    model: sdk.responses(lookupGrokModel(config, modelCache)),
    tools: { x_search: sdk.tools.xSearch(options) },
  });
}

/**
 * The Grok a search runs on, read from the account's own catalog so a model
 * xAI retires is never asked for: its newest non-reasoning model, since a
 * search is a lookup (measured on 2026-10-19 at about 6 seconds where Grok
 * 4.7 took 16, finding the same posts), else its default, else xAI's alias.
 */
function lookupGrokModel(
  config: AIGatewayProviderConfig.Type,
  modelCache: ModelCache | undefined,
): string {
  const listed = modelCache?.read(config.cacheIdentifier) ?? [];
  const newestFirst = listed.toSorted((a, b) =>
    (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""),
  );
  return (
    newestFirst.find((model) => model.canonicalId.includes("non-reasoning"))
      ?.providerId ??
    newestFirst.find((model) => model.tags.includes("default"))?.providerId ??
    X_SEARCH_FALLBACK_MODEL
  );
}

export async function getWebSearchModel({
  callingModel,
  configs,
  modelCache,
  workspaceServerURL,
}: {
  callingModel: AIGatewayModel.Type;
  configs: AIGatewayProviderConfig.Type[];
  modelCache?: ModelCache;
  workspaceServerURL: WorkspaceServerURL;
}) {
  const preferredProviderConfig = configs.find(
    (c) => c.id === callingModel.params.providerConfigId,
  );

  if (!preferredProviderConfig) {
    return Result.error(
      new TypedError.NotFound("No AI provider found for current model"),
    );
  }

  const supportedConfigs = filterWebSearchConfigs(configs);

  const configsToTry = selectProviderConfigs({
    configs: supportedConfigs,
    preferredProviderConfig,
    providerTypePriority: PROVIDER_TYPE_PRIORITY,
  });

  if (configsToTry.length === 0) {
    return Result.error(
      new TypedError.NotFound("No provider with web search support found"),
    );
  }

  for (const config of configsToTry) {
    const result = await getAISDKWebSearchModel({
      callingModel,
      config,
      modelCache,
      workspaceServerURL,
    });
    if (result.ok) {
      return Result.ok({ ...result.value, config });
    }
  }

  return Result.error(
    new TypedError.NotFound("No provider with web search support found"),
  );
}
