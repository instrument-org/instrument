import { type AIGatewayModel } from "../../schemas/model";
import { AIGatewayModelURI } from "../../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { addHeuristicTags } from "../add-heuristic-tags";
import { generateModelName } from "../generate-model-name";
import { isModelNew } from "../is-model-new";
import { getProviderMetadata } from "../providers/metadata";
import { modalityFeatures } from "./modality-features";

interface OpenRouterShapedModel {
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  };
  created: number;
  id: string;
  name: string;
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
  const colonIndex = model.name.indexOf(":");
  const modelName =
    colonIndex === -1
      ? model.name || generateModelName(canonicalId)
      : model.name.slice(colonIndex + 1);

  return addHeuristicTags(
    {
      author,
      canonicalId,
      features,
      name: modelName,
      params,
      providerId,
      providerName: config.displayName ?? metadata.name,
      tags,
      uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
    },
    config,
  );
}
