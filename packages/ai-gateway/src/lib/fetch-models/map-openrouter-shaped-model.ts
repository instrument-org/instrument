import { type AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { generateModelName } from "../generate-model-name";
import { isModelNew } from "../is-model-new";
import { pricingPerMillionTokens } from "../model-pricing";
import { modelReleaseDate } from "../parse-model-date";
import { getProviderMetadata } from "../providers/metadata";
import { modalityFeatures } from "./modality-features";

interface OpenRouterShapedModel {
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  };
  context_length?: null | number;
  created: number;
  id: string;
  instrument?: { restricted?: AIGatewayModel.Restriction };
  name: string;
  pricing?: null | { completion?: null | string; prompt?: null | string };
  reasoning?: null | {
    default_effort?: null | string;
    default_enabled?: boolean | null;
    mandatory?: boolean | null;
    supported_efforts?: null | string[];
  };
  supported_parameters?: null | string[];
}

export function mapOpenRouterShapedModel({
  author,
  canonicalId,
  config,
  model,
  providerId,
}: {
  author: string;
  canonicalId: AIGatewayModel.CanonicalId;
  config: AIGatewayProviderConfig.Type;
  model: OpenRouterShapedModel;
  providerId: AIGatewayModel.ProviderId;
}) {
  const metadata = getProviderMetadata(config.type);
  const features = modalityFeatures({
    inputModalities: model.architecture.input_modalities,
    outputModalities: model.architecture.output_modalities,
    toolSupport: model.supported_parameters?.includes("tools") ?? false,
  });

  const tags: AIGatewayModel.ModelTag[] = [];
  if (isModelNew(model.created)) {
    tags.push("new");
  }

  const params = { provider: config.type, providerConfigId: config.id };
  // OpenRouter writes the author into the name ("Anthropic: Claude Sonnet 5"),
  // and not on every entry. The space after the colon has to come off with it,
  // or the names carrying one sort as a block ahead of the names that do not
  // and a family ends up split across the list.
  const colonIndex = model.name.indexOf(":");
  const named = (
    colonIndex === -1 ? model.name : model.name.slice(colonIndex + 1)
  ).trim();
  const modelName = named || generateModelName(canonicalId);

  return addHeuristicTags(
    {
      author,
      canonicalId,
      contextLength: model.context_length ?? undefined,
      features,
      name: modelName,
      params,
      pricing: pricingPerMillionTokens(model.pricing),
      providerId,
      providerName: config.displayName ?? metadata.name,
      reasoning: model.reasoning
        ? {
            defaultEffort: model.reasoning.default_effort ?? undefined,
            efforts: model.reasoning.supported_efforts ?? [],
            enabledByDefault: model.reasoning.default_enabled ?? false,
            mandatory: model.reasoning.mandatory ?? false,
          }
        : undefined,
      releasedAt: modelReleaseDate(model.created),
      restricted: model.instrument?.restricted,
      tags,
      uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
    },
    config,
  );
}
