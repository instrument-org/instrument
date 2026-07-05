// Static import because @ai-sdk/gateway is already statically imported by the ai package,
// so dynamic import won't code-split it into a separate chunk
import { createGateway } from "@ai-sdk/gateway";
import ms from "ms";
import { unique } from "radashi";
import { Result } from "typescript-result";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { getCachedResult, setCachedResult } from "../cache";
import { TypedError } from "../errors";
import { getModelFeatures } from "../get-model-features";
import { getProviderMetadata } from "../providers/metadata";

// Unlike the other providers, Vercel model fetching goes through the AI SDK
// gateway (not fetchJson), whose getAvailableModels() takes no abort signal.
// Bound it with a timeout race so a hanging gateway fails fast and falls back
// to the disk cache instead of blocking startup.
const MODELS_FETCH_TIMEOUT = ms("15 seconds");

export function fetchModelsForVercel(config: AIGatewayProviderConfig.Type) {
  return Result.gen(function* () {
    const metadata = getProviderMetadata(config.type);
    const cacheKey = `vercel-models-${config.apiKey}`;
    const cachedModels = getCachedResult<AIGatewayModel.Type[]>(cacheKey);

    if (cachedModels !== undefined) {
      return cachedModels;
    }

    const gatewayProvider = createGateway({ apiKey: config.apiKey });
    const { models } = yield* Result.try(
      async () =>
        await withTimeout(
          gatewayProvider.getAvailableModels(),
          "Fetching models from Vercel AI Gateway timed out",
        ),
      (error) =>
        new TypedError.Fetch("Fetching models from Vercel AI Gateway failed", {
          cause: error,
        }),
    );

    const validModels: AIGatewayModel.Type[] = [];

    for (const model of models) {
      const providerId = AIGatewayModel.ProviderIdSchema.parse(model.id);
      const [author, modelId] = providerId.split("/");
      if (!author || !modelId) {
        return Result.error(
          new TypedError.Parse(`Invalid model ID for vercel: ${model.id}`),
        );
      }

      const canonicalModelId = AIGatewayModel.CanonicalIdSchema.parse(modelId);
      let features = getModelFeatures(canonicalModelId);

      if (model.modelType === "language") {
        features.push("tools", "inputText", "outputText");
        features = unique(features);
      }

      const params = { provider: config.type, providerConfigId: config.id };

      validModels.push(
        addHeuristicTags(
          {
            author,
            canonicalId: canonicalModelId,
            features,
            name: model.name,
            params,
            providerId,
            providerName: config.displayName ?? metadata.name,
            tags: [],
            uri: AIGatewayModelURI.fromModel({
              author,
              canonicalId: canonicalModelId,
              params,
            }),
          },
          config,
        ),
      );
    }

    setCachedResult(cacheKey, validModels);
    return validModels;
  });
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, MODELS_FETCH_TIMEOUT);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
