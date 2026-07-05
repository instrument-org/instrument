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
