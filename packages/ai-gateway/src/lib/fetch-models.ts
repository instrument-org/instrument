import {
  type CaptureExceptionFunction,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { Result } from "typescript-result";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { demoteVariantsOfListedModels } from "./demote-variants-of-listed-models";
import { TypedError } from "./errors";
import { fetchAndParseAnthropicModels } from "./fetch-models/anthropic";
import { fetchAndParseGoogleModels } from "./fetch-models/google";
import { fetchAndParseOpenAIModels } from "./fetch-models/openai";
import { fetchAndParseOpenAICompatibleModels } from "./fetch-models/openai-compatible";
import { fetchModelsForOpenRouter } from "./fetch-models/openrouter";
import { isWorkersAiProviderConfig } from "./fetch-models/parse-workers-ai-base-url";
import { fetchModelsForVercel } from "./fetch-models/vercel";
import { fetchAndParseWorkersAiModels } from "./fetch-models/workers-ai";
import { type ModelCache } from "./model-cache";

const capturedErrors = new Set<string>();
const TRANSIENT_FETCH_ERROR_PATTERN =
  /network|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

export function fetchModelsForProvider(
  config: AIGatewayProviderConfig.Type,
  {
    captureException,
    modelCache,
  }: { captureException: CaptureExceptionFunction; modelCache: ModelCache },
) {
  return Result.fromAsyncCatching(
    async () => {
      switch (config.type) {
        case "anthropic": {
          return fetchAndParseAnthropicModels(config);
        }
        case "google": {
          return fetchAndParseGoogleModels(config);
        }
        case "openai": {
          return fetchAndParseOpenAIModels(config);
        }
        case "openai-compatible": {
          if (isWorkersAiProviderConfig(config)) {
            return fetchAndParseWorkersAiModels(config);
          }
          return fetchAndParseOpenAICompatibleModels(config);
        }
        case "openrouter":
        case OUR_PROVIDER_CONFIG.type: {
          return fetchModelsForOpenRouter(config);
        }
        case "vercel": {
          return fetchModelsForVercel(config);
        }
        default: {
          return fetchAndParseOpenAICompatibleModels(config);
        }
      }
    },
    (error) => {
      return new TypedError.Unknown("Failed to fetch models for provider", {
        cause: error,
      });
    },
  )
    .map((rawModels) => {
      // The one place that holds a provider's whole list, which is what the
      // variant rule needs to see, and it runs before the cache write so a
      // cached read carries the same tags a fresh fetch would.
      const models = demoteVariantsOfListedModels(rawModels);

      // Don't cache an empty list: a transient empty (or filtered-to-nothing)
      // response would otherwise clobber the last-known-good models and defeat
      // the fallback below.
      if (models.length > 0) {
        modelCache.write(config.cacheIdentifier, models);
      }
      return models;
    })
    .onFailure((error) => {
      const captureKey = getCaptureKey(config, error);
      if (!capturedErrors.has(captureKey)) {
        capturedErrors.add(captureKey);
        captureException(error);
      }
    })
    .recover((error) => {
      const cached = modelCache.read(config.cacheIdentifier);
      if (cached && shouldUseCachedModels(error)) {
        return Result.ok(cached);
      }
      return Result.error(error);
    });
}

function getCaptureKey(config: AIGatewayProviderConfig.Type, error: Error) {
  return `${config.type}:${config.id}:${error.message}`;
}

function shouldUseCachedModels(error: Error) {
  let current: unknown = error;

  while (current instanceof Error || current instanceof DOMException) {
    if (current instanceof TypeError) {
      return true;
    }

    if (
      current.name === "AbortError" ||
      current.name === "TimeoutError" ||
      TRANSIENT_FETCH_ERROR_PATTERN.test(current.message)
    ) {
      return true;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}
