import { type LanguageModelV4 } from "@ai-sdk/provider";
import {
  type CaptureExceptionFunction,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { Result } from "typescript-result";

import { AIGatewayModelURI } from "../schemas/model-uri";
import {
  type AIGatewayProviderConfig,
  TEST_MODEL_OVERRIDE_KEY,
} from "../schemas/provider-config";
import { aiSDKForProviderConfig } from "./ai-sdk-for-provider-config";
import { TypedError } from "./errors";
import { fetchModel } from "./fetch-model";
import { type ModelCache } from "./model-cache";
import { type ModelRoutes } from "./route-model";

export async function fetchAISDKModel({
  captureException,
  configs,
  modelCache,
  modelRoutes,
  modelURI,
  workspaceServerURL,
}: {
  captureException: CaptureExceptionFunction;
  configs: AIGatewayProviderConfig.Type[];
  modelCache: ModelCache;
  modelRoutes?: ModelRoutes;
  modelURI: AIGatewayModelURI.Type;
  workspaceServerURL: WorkspaceServerURL;
}) {
  return Result.gen(async function* () {
    // Test override: check early to avoid fetching models over network
    const modelURIDetails = AIGatewayModelURI.parse(modelURI).getOrThrow();
    const config = configs.find(
      (c) => c.id === modelURIDetails.params.providerConfigId,
    );

    if (config) {
      const testOverride = (
        config as { [TEST_MODEL_OVERRIDE_KEY]?: LanguageModelV4 }
      )[TEST_MODEL_OVERRIDE_KEY];
      if (testOverride) {
        return testOverride;
      }
    }

    const model = yield* await fetchModel({
      captureException,
      configs,
      modelCache,
      modelRoutes,
      modelURI,
    });
    // The connection the model was reached by, which for a URI another
    // computer chose is not the one it names.
    const routed = configs.find((c) => c.id === model.params.providerConfigId);

    if (!routed) {
      return Result.error(
        new TypedError.NotFound(`Provider ${model.params.provider} not found`),
      );
    }

    const sdk = await aiSDKForProviderConfig(routed, workspaceServerURL, {
      sourceModelIdOf: (modelId) =>
        modelId === model.providerId ? model.sourceModelId : undefined,
    });
    return sdk(model.providerId);
  });
}
