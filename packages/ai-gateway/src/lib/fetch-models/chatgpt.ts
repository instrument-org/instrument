import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { generateModelName } from "../generate-model-name";
import { getModelFeatures } from "../get-model-features";
import { getProviderMetadata } from "../providers/metadata";
import { fetchOpenAIModels } from "./openai";

/**
 * The catalog a ChatGPT plan answers `/v1/models` with: the models this
 * account may use, in the order ChatGPT shows them. It is not the API's
 * `{ data: [{ id }] }` list.
 */
const ChatGPTPlanModelsSchema = z.object({
  models: z.array(
    z.object({
      display_name: z.string().optional(),
      slug: z.string(),
      visibility: z.string().optional(),
    }),
  ),
});

export function fetchAndParseChatGPTPlanModels(
  config: AIGatewayProviderConfig.Type,
) {
  return Result.gen(function* () {
    // The catalog is per account and changes with the plan, so it is always
    // read fresh.
    const data = yield* fetchOpenAIModels(config, { cache: false });

    const { models } = yield* Result.try(
      () => ChatGPTPlanModelsSchema.parse(data),
      (error) =>
        new TypedError.Parse("Failed to validate the ChatGPT plan's models", {
          cause: error,
        }),
    );

    const metadata = getProviderMetadata(config.type);
    const author = "openai";
    const params = { provider: config.type, providerConfigId: config.id };

    return models
      .filter(
        (model) =>
          model.visibility === undefined || model.visibility === "list",
      )
      .map((model) => {
        const providerId = AIGatewayModel.ProviderIdSchema.parse(model.slug);
        const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(providerId);
        return addHeuristicTags(
          {
            author,
            canonicalId,
            features: getModelFeatures(canonicalId),
            name: model.display_name
              ? spaceBeforeFamily(model.display_name)
              : generateModelName(canonicalId),
            params,
            providerId,
            providerName: config.displayName ?? metadata.name,
            tags: [],
            uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
          },
          config,
        );
      });
  });
}

/**
 * ChatGPT's label with a space, not a dash, between the version and the
 * model family: "GPT-5.6-Luna" reads as "GPT-5.6 Luna", the way the model is
 * named everywhere else. The dash after "GPT" stays.
 */
export function spaceBeforeFamily(label: string): string {
  return label.replace(/^(GPT-\d+(?:\.\d+)?)-(?=\p{L})/u, "$1 ");
}
