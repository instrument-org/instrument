import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { Result } from "typescript-result";

import { AIGatewayModelURI } from "../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { TypedError } from "./errors";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";

export async function fetchModel({
  captureException,
  configs,
  modelCache,
  modelURI,
}: {
  captureException: CaptureExceptionFunction;
  configs: AIGatewayProviderConfig.Type[];
  modelCache: ModelCache;
  modelURI: AIGatewayModelURI.Type;
}) {
  return Result.gen(async function* () {
    const [modelURIDetails, error] =
      AIGatewayModelURI.parse(modelURI).toTuple();
    if (error) {
      return Result.error(
        new TypedError.NotFound(`Invalid model URI: ${modelURI}`),
      );
    }

    const config = configs.find(
      (c) => c.id === modelURIDetails.params.providerConfigId,
    );
    if (!config) {
      return Result.error(
        new TypedError.NotFound(
          `Provider config for ${modelURIDetails.params.providerConfigId} not found`,
        ),
      );
    }

    // Resolve from the cache before going to the provider. This runs on task
    // creation, on every new session and message, and on every turn, so a
    // provider round trip here sits directly in front of the user's submit --
    // and the models list the UI subscribes to is what keeps the cache current.
    // The fetch below still covers a cold cache and a model too new to be in
    // one.
    const cachedModel = modelCache
      .read(config.cacheIdentifier)
      ?.find((m) => m.uri === modelURI);
    if (cachedModel) {
      return cachedModel;
    }

    const models = yield* await fetchModelsForProvider(config, {
      captureException,
      modelCache,
    });

    const model = models.find((m) => m.uri === modelURI);
    if (!model) {
      return Result.error(
        new TypedError.NotFound(`Model ${modelURI} not found`),
      );
    }

    return model;
  });
}
