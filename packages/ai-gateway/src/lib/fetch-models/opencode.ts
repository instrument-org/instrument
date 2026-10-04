import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { generateModelName } from "../generate-model-name";
import { getModelFeatures } from "../get-model-features";
import { openCodeAuthor } from "../opencode";
import { getProviderMetadata } from "../providers/metadata";
import { fetchOpenAICompatibleModels } from "./openai-compatible";

const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/**
 * OpenCode's model list, in OpenAI's shape but carrying only ids worth
 * reading: every entry names OpenCode as its owner and the moment of the
 * request as its creation, so the vendor comes from the id and no release
 * date is claimed.
 */
export function fetchAndParseOpenCodeModels(
  config: AIGatewayProviderConfig.Type,
) {
  return Result.gen(function* () {
    const data = yield* fetchOpenAICompatibleModels(config);
    const response = yield* Result.try(
      () => ModelsResponseSchema.parse(data),
      (error) =>
        new TypedError.Parse(`Failed to validate models from ${config.type}`, {
          cause: error,
        }),
    );

    const metadata = getProviderMetadata(config.type);
    return response.data.map(({ id }) => {
      const providerId = AIGatewayModel.ProviderIdSchema.parse(id);
      const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(id);
      const author = openCodeAuthor(id);
      const params = { provider: config.type, providerConfigId: config.id };
      return addHeuristicTags(
        {
          author,
          canonicalId,
          features: getModelFeatures(canonicalId),
          name: generateModelName(canonicalId),
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
