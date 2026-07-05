import {
  type CaptureExceptionFunction,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { Result } from "typescript-result";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
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
    .map((models) => {
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
      // Network failed — fall back to the cached models so a slow or
      // unreachable provider does not block workspace operations on app
      // restart. With no cache (e.g. first-ever launch), keep the original
      // error so behavior is unchanged.
      const cached = modelCache.read(config.cacheIdentifier);
      return cached ? Result.ok(cached) : Result.error(error);
    });
}

function getCaptureKey(config: AIGatewayProviderConfig.Type, error: Error) {
  return `${config.type}:${config.id}:${error.message}`;
}
