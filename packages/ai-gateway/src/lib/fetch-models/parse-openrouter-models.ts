import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { mapOpenRouterShapedModel } from "./map-openrouter-shaped-model";

const OpenRouterModelSchema = z.object({
  architecture: z.object({
    input_modalities: z.array(z.string()),
    instruct_type: z.string().nullish(),
    output_modalities: z.array(z.string()),
    tokenizer: z.string(),
  }),
  created: z.number(),
  description: z.string(),
  id: z.string(),
  name: z.string(),
  supported_parameters: z.array(z.string()).nullish(),
});

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

export function parseOpenRouterModelsList({
  config,
  data,
}: {
  config: AIGatewayProviderConfig.Type;
  data: unknown;
}) {
  return Result.gen(function* () {
    const modelsResult = yield* Result.try(
      () => OpenRouterModelsResponseSchema.parse(data),
      (error) =>
        new TypedError.Parse(`Failed to validate models from ${config.type}`, {
          cause: error,
        }),
    );

    const validModels: AIGatewayModel.Type[] = [];
    for (const model of modelsResult.data) {
      const providerId = AIGatewayModel.ProviderIdSchema.parse(model.id);
      const split = splitOpenRouterProviderId(providerId);
      if (!split) {
        return Result.error(
          new TypedError.Parse(
            `Invalid model ID for ${config.type}: ${model.id}`,
          ),
        );
      }

      const { author, modelId } = split;
      const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(modelId);

      validModels.push(
        mapOpenRouterShapedModel({
          author,
          canonicalId,
          config,
          model,
          providerId,
        }),
      );
    }

    const baseModelsWithExacto = new Set<string>();

    for (const model of validModels) {
      if (model.canonicalId.endsWith(":exacto")) {
        const baseModelId = model.canonicalId.slice(0, -7);
        baseModelsWithExacto.add(baseModelId);
      }
    }

    for (const model of validModels) {
      const isExactoModel = model.canonicalId.endsWith(":exacto");

      if (isExactoModel) {
        model.tags.push("exacto");
        model.name = model.name.replace(/\s*\(exacto\)\s*$/i, "");
        const baseModelId = model.canonicalId.slice(0, -7);
        const baseModel = addHeuristicTags(
          {
            ...model,
            canonicalId: AIGatewayModel.CanonicalIdSchema.parse(baseModelId),
            tags: [],
          },
          config,
        );

        for (const tag of baseModel.tags) {
          if (!model.tags.includes(tag)) {
            model.tags.push(tag);
          }
        }
      } else if (baseModelsWithExacto.has(model.canonicalId)) {
        model.tags = model.tags.filter(
          (tag) => tag !== "recommended" && tag !== "default",
        );
      }
    }

    return validModels;
  });
}

function splitOpenRouterProviderId(providerId: string) {
  const slashIndex = providerId.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }

  const author = providerId.slice(0, slashIndex);
  const modelId = providerId.slice(slashIndex + 1);
  if (!author || !modelId) {
    return null;
  }

  return { author, modelId };
}
