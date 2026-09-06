import { Result } from "typescript-result";
import { z } from "zod";

import { AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { TypedError } from "../errors";
import { generateModelName } from "../generate-model-name";
import { isModelNew } from "../is-model-new";
import { modelReleaseDate } from "../parse-model-date";
import { getProviderMetadata } from "../providers/metadata";
import { modalityFeatures } from "./modality-features";

const WorkersAiOpenRouterModelSchema = z.object({
  created: z.number(),
  description: z.string(),
  id: z.string(),
  input_modalities: z.array(z.string()).default([]),
  name: z.string(),
  output_modalities: z.array(z.string()).default([]),
  supported_features: z.array(z.string()).nullish(),
});

type WorkersAiOpenRouterModel = z.output<typeof WorkersAiOpenRouterModelSchema>;

// When format=openrouter is set, Cloudflare returns the OpenRouter marketplace
// shape { data: [...] } directly, not the standard v4 { result, success } wrapper.
const WorkersAiOpenRouterResponseSchema = z.object({
  data: z.array(WorkersAiOpenRouterModelSchema),
});

export function parseWorkersAiModelsList({
  config,
  models,
}: {
  config: AIGatewayProviderConfig.Type;
  models: WorkersAiOpenRouterModel[];
}) {
  const metadata = getProviderMetadata(config.type);
  const validModels: AIGatewayModel.Type[] = [];

  for (const model of models) {
    if (!model.output_modalities.includes("text")) {
      continue;
    }

    const providerId = AIGatewayModel.ProviderIdSchema.parse(model.id);
    // Workers AI model IDs are expected in @cf/author/model form; strip the
    // prefix to extract author and canonicalId. An entry with any other shape
    // must not take down the provider's whole list, so skip it like the
    // modality and feature filters do.
    if (!providerId.startsWith("@cf/")) {
      continue;
    }

    const withoutPrefix = providerId.slice(4);
    const slashIndex = withoutPrefix.indexOf("/");
    if (slashIndex === -1) {
      continue;
    }

    const author = withoutPrefix.slice(0, slashIndex);
    const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(
      withoutPrefix.slice(slashIndex + 1),
    );

    const features = modalityFeatures({
      inputModalities: model.input_modalities,
      outputModalities: model.output_modalities,
      toolSupport: model.supported_features?.includes("tools") ?? false,
    });

    if (!features.includes("tools")) {
      continue;
    }

    const tags: AIGatewayModel.ModelTag[] = [];
    if (isModelNew(model.created)) {
      tags.push("new");
    }

    const params = { provider: config.type, providerConfigId: config.id };
    // Cloudflare's name is the id title-cased word by word ("Zai Org: Glm 5.3
    // Flash"), so it carries nothing the id does not and gets the brands
    // wrong. Our own generator knows GLM, GPT, OSS and DeepSeek.
    const modelName = generateModelName(canonicalId);

    validModels.push(
      addHeuristicTags(
        {
          author,
          canonicalId,
          features,
          name: modelName,
          params,
          providerId,
          providerName: config.displayName ?? metadata.name,
          releasedAt: modelReleaseDate(model.created),
          tags,
          uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
        },
        config,
      ),
    );
  }

  return Result.ok(validModels);
}

export function parseWorkersAiModelsSearchPage(payload: unknown) {
  const parsed = WorkersAiOpenRouterResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return Result.error(
      new TypedError.Parse("Failed to validate Workers AI models search page", {
        cause: parsed.error,
      }),
    );
  }

  return Result.ok(parsed.data.data);
}
