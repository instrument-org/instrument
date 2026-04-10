import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  type AIProviderType,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";

export function createMockAIGatewayModel(
  options: {
    author?: string;
    features?: AIGatewayModel.ModelFeatures[];
    provider?: AIProviderType;
  } = {},
): AIGatewayModel.Type {
  const {
    author = "test",
    features = ["inputText", "outputText", "tools"],
    provider = OUR_PROVIDER_CONFIG.type,
  } = options;
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse("mock-model-id");
  const providerConfigId = AIProviderConfigIdSchema.parse(
    "mock-provider-config-id",
  );
  const providerId = AIGatewayModel.ProviderIdSchema.parse("mock-provider-id");

  return AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features,
    name: "Mock Model",
    params: {
      provider,
      providerConfigId,
    },
    providerId,
    providerName: "Test Provider",
    tags: ["default"],
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId,
      params: {
        provider,
        providerConfigId,
      },
    }),
  });
}
