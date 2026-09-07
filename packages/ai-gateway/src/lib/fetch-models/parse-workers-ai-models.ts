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

/**
 * What a Workers AI model that says it reasons will take from us.
 *
 * Cloudflare's catalog says whether a model reasons and never says at what
 * levels, and the models disagree: asked across the whole text-generation
 * catalog, `low` and `medium` were accepted by every one of the sixteen that
 * take tools, `high` by fifteen (qwen3.8 answers 400 and asks for `xhigh`
 * instead), and `minimal` by seven. A rejected level is a 400 that ends the
 * turn, so the rungs claimed here are the ones measured to be universal, and
 * anything above them steps down to `medium`.
 *
 * `low` is the rung that matters: on the orchestrator's first turn it is the
 * difference between a model that thinks for half a minute before saying
 * anything and one that answers in three seconds.
 */
const WORKERS_AI_REASONING: AIGatewayModel.Reasoning = {
  // What one of these runs at when nobody chose. These models think whether or
  // not we ask and never say for how long, and left alone GLM 5.3 Flash takes a
  // median 22.8 seconds and a p90 of 61.7 before it says a word the user can
  // read; at `high` that is 4.9 and 8.3, and its share of correct first moves
  // over a five-case delegation suite went up rather than down. `low` is faster
  // still and measurably worse at deciding, which is why the rung named here is
  // not the lowest one.
  defaultEffort: "high",
  efforts: ["low", "medium", "high"],
  enabledByDefault: true,
  mandatory: false,
};

/**
 * The models measured to answer 400 to a rung the rest of the catalog takes,
 * with the rungs they refuse. Sent one anyway, the request fails and the turn
 * dies, so this is carried rather than discovered at runtime.
 *
 * `minimal` is not in our ladder and so cannot be asked for; it is the other
 * value that splits the catalog, accepted by seven of sixteen.
 */
const WORKERS_AI_REFUSED_EFFORTS: Record<string, string[]> = {
  // Answers `Unexpected reasoning effort. Supported types are xhigh (default),
  // medium, and low` -- its own ladder, with no rung named `high` on it.
  "@cf/qwen/qwen3.8-27b": ["high"],
};

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

    const refused = WORKERS_AI_REFUSED_EFFORTS[model.id] ?? [];
    const reasoning = model.supported_features?.includes("reasoning")
      ? {
          ...WORKERS_AI_REASONING,
          efforts: WORKERS_AI_REASONING.efforts.filter(
            (effort) => !refused.includes(effort),
          ),
        }
      : undefined;

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
          ...(reasoning ? { reasoning } : {}),
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
