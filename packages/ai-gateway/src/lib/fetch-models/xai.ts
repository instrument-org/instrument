import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { fetchJson } from "../fetch-json";
import { generateModelName } from "../generate-model-name";
import { getModelFeatures } from "../get-model-features";
import { isModelNew } from "../is-model-new";
import { modelReleaseDate } from "../parse-model-date";
import { getProviderMetadata } from "../providers/metadata";
import { openAICompatibleURL } from "../providers/openai-compatible-url";
import { setProviderAuthHeaders } from "../providers/set-auth-headers";

const LanguageModelsSchema = z.object({
  models: z.array(
    z.object({
      created: z.number().optional(),
      id: z.string(),
      input_modalities: z.array(z.string()).optional(),
    }),
  ),
});

/** Who makes the models, whichever way they are reached: a key or a Grok account. */
const AUTHOR = "x-ai";

/**
 * xAI's chat models, from `/language-models` rather than `/models`, which
 * lists the Imagine image and video models beside them as if they could hold
 * a conversation.
 */
export function fetchAndParseXAIModels(config: AIGatewayProviderConfig.Type) {
  return Result.gen(function* () {
    const headers = new Headers({ "Content-Type": "application/json" });
    setProviderAuthHeaders(headers, config);
    const data = yield* fetchJson({
      headers,
      url: openAICompatibleURL({ config, path: "/language-models" }),
    });
    const { models } = yield* Result.try(
      () => LanguageModelsSchema.parse(data),
      (error) =>
        new TypedError.Parse(`Failed to validate models from ${config.type}`, {
          cause: error,
        }),
    );

    const metadata = getProviderMetadata(config.type);
    const params = { provider: config.type, providerConfigId: config.id };
    return models.map((model) => {
      const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(model.id);
      return addHeuristicTags(
        {
          author: AUTHOR,
          canonicalId,
          features: getModelFeatures(canonicalId),
          name: generateModelName(canonicalId),
          params,
          providerId: AIGatewayModel.ProviderIdSchema.parse(model.id),
          providerName: config.displayName ?? metadata.name,
          releasedAt: modelReleaseDate(model.created),
          tags: isModelNew(model.created) ? ["new"] : [],
          uri: AIGatewayModelURI.fromModel({
            author: AUTHOR,
            canonicalId,
            params,
          }),
        },
        config,
      );
    });
  });
}
