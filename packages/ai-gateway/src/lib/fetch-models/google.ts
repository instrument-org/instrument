import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { fetchJson } from "../fetch-json";
import { getModelFeatures } from "../get-model-features";
import { apiURL } from "../providers/api-url";
import { getProviderMetadata } from "../providers/metadata";
import { setProviderAuthHeaders } from "../providers/set-auth-headers";

const ModelSchema = z.object({
  description: z.string().optional(),
  displayName: z.string(),
  inputTokenLimit: z.number(),
  maxTemperature: z.number().optional(),
  name: z.string(),
  outputTokenLimit: z.number(),
  supportedGenerationMethods: z.array(z.string()),
  temperature: z.number().optional(),
  thinking: z.boolean().optional(),
  topK: z.number().optional(),
  topP: z.number().optional(),
  version: z.string(),
});

const GoogleModelsResponseSchema = z.object({
  models: z.array(ModelSchema),
  nextPageToken: z.string().optional(),
});

type MinimalProviderConfig = Pick<
  AIGatewayProviderConfig.Type,
  "apiKey" | "baseURL" | "type"
>;

// The documented maximum page size; the pagination loop covers a catalog that
// grows past it.
const GOOGLE_MODELS_PAGE_SIZE = 1000;

export function fetchAndParseGoogleModels(
  config: AIGatewayProviderConfig.Type,
) {
  return Result.gen(async function* () {
    const models = yield* await fetchAllGoogleModels(config);
    const metadata = getProviderMetadata(config.type);

    const author = config.type;
    return Result.ok(
      models.map((model) => {
        const providerId = AIGatewayModel.ProviderIdSchema.parse(model.name);
        let canonicalModelId = AIGatewayModel.CanonicalIdSchema.parse(
          model.name,
        );
        const [prefix, modelId] = model.name.split("/");
        if (prefix === "models") {
          canonicalModelId = AIGatewayModel.CanonicalIdSchema.parse(modelId);
        }

        const features = getModelFeatures(canonicalModelId);

        const params = { provider: config.type, providerConfigId: config.id };

        return addHeuristicTags(
          {
            author,
            canonicalId: canonicalModelId,
            contextLength: model.inputTokenLimit,
            features,
            name: model.displayName,
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
        );
      }),
    );
  });
}

export function fetchGoogleModels(
  config: MinimalProviderConfig,
  {
    cache = true,
    pageSize,
    pageToken,
  }: { cache?: boolean; pageSize?: number; pageToken?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  setProviderAuthHeaders(headers, config);

  const url = new URL(apiURL({ config, path: "/models" }));
  if (pageSize !== undefined) {
    url.searchParams.set("pageSize", String(pageSize));
  }
  if (pageToken !== undefined) {
    url.searchParams.set("pageToken", pageToken);
  }
  return fetchJson({
    cache,
    headers,
    url: url.toString(),
  });
}

function fetchAllGoogleModels(config: MinimalProviderConfig) {
  return Result.gen(async function* () {
    const allModels = [];
    let pageToken: string | undefined;

    do {
      const data = yield* await fetchGoogleModels(config, {
        pageSize: GOOGLE_MODELS_PAGE_SIZE,
        pageToken,
      });

      const page = yield* Result.try(
        () => GoogleModelsResponseSchema.parse(data),
        (error) =>
          new TypedError.Parse(
            `Failed to validate models from ${config.type}`,
            { cause: error },
          ),
      );

      allModels.push(...page.models);
      pageToken = page.nextPageToken;
    } while (pageToken);

    return Result.ok(allModels);
  });
}
