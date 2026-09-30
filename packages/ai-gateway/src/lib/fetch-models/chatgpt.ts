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
import { outranksRelease, readModelRelease } from "../read-model-release";
import { fetchOpenAIModels } from "./openai";

/**
 * The catalog a ChatGPT plan answers `/v1/models` with: the models this
 * account may use, in the order ChatGPT shows them. It is not the API's
 * `{ data: [{ id }] }` list.
 */
const ChatGPTPlanModelsSchema = z.object({
  models: z.array(
    z.object({
      context_window: z.number().int().positive().optional(),
      default_reasoning_level: z.string().optional(),
      display_name: z.string().optional(),
      slug: z.string(),
      supported_reasoning_levels: z
        .array(z.object({ effort: z.string() }))
        .optional(),
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
            contextLength: model.context_window,
            features: getModelFeatures(canonicalId),
            name: model.display_name
              ? spaceBeforeFamily(model.display_name)
              : generateModelName(canonicalId),
            params,
            providerId,
            providerName: config.displayName ?? metadata.name,
            // The plan's own levels, so the effort picker offers what the
            // plan accepts. Every model it lists reasons, and cannot be told
            // not to.
            reasoning: model.supported_reasoning_levels?.length
              ? {
                  defaultEffort: model.default_reasoning_level,
                  efforts: model.supported_reasoning_levels.map(
                    (level) => level.effort,
                  ),
                  enabledByDefault: true,
                  mandatory: true,
                }
              : undefined,
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

/**
 * The plan's everyday tier, most preferred first. Terra is left out: it costs
 * more than Sol and is not the line to point a new user at.
 */
const DEFAULT_TIERS = ["sol", "luna"];

/**
 * The model a ChatGPT sign-in makes the default: the newest release of the
 * most preferred tier the account lists, so a plan that gains `gpt-6-sol`
 * gets it over `gpt-5.6-sol` without a change here. The first model listed
 * when none of the tiers is.
 */
export function chatGPTPlanDefaultModel<Model extends { canonicalId: string }>(
  models: Model[],
): Model | undefined {
  for (const tier of DEFAULT_TIERS) {
    let newest: Model | undefined;
    let newestRelease: ReturnType<typeof readModelRelease>;
    for (const model of models) {
      if (!model.canonicalId.endsWith(`-${tier}`)) {
        continue;
      }
      const release = readModelRelease(model.canonicalId);
      if (
        !newest ||
        (release && (!newestRelease || outranksRelease(release, newestRelease)))
      ) {
        newest = model;
        newestRelease = release;
      }
    }
    if (newest) {
      return newest;
    }
  }
  return models[0];
}
