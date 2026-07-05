import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { parallel } from "radashi";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";
import { getProviderMetadata } from "./providers/metadata";

export async function fetchModelResultsForProviders(
  configs: AIGatewayProviderConfig.Type[],
  {
    captureException,
    modelCache,
  }: { captureException: CaptureExceptionFunction; modelCache: ModelCache },
) {
  return await parallel(10, configs, (config) =>
    fetchModelsForProvider(config, { captureException, modelCache }).mapError(
      (error) => {
        const metadata = getProviderMetadata(config.type);
        return {
          config: {
            displayName: config.displayName || metadata.name,
            id: config.id,
            type: config.type,
          },
          message:
            error.type === "gateway-fetch-error"
              ? `Failed to fetch models for ${config.displayName ?? metadata.name}`
              : error.message,
        };
      },
    ),
  );
}
