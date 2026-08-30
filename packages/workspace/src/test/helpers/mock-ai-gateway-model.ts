import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import {
  AIProviderConfigIdSchema,
  type AIProviderType,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";

export function createMockAIGatewayModel(
  options: {
    author?: string;
    canonicalId?: string;
    /** Omitted by default, which is what a provider reporting no window gives. */
    contextLength?: number;
    features?: AIGatewayModel.ModelFeatures[];
    name?: string;
    provider?: AIProviderType;
    providerConfigId?: string;
    providerId?: string;
  } = {},
): AIGatewayModel.Type {
  const {
    author = "test",
    contextLength,
    features = ["inputText", "outputText", "tools"],
    provider = OUR_PROVIDER_CONFIG.type,
  } = options;
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(
    options.canonicalId ?? "mock-model-id",
  );
  const providerConfigId = AIProviderConfigIdSchema.parse(
    options.providerConfigId ?? "mock-provider-config-id",
  );
  const providerId = AIGatewayModel.ProviderIdSchema.parse(
    options.providerId ?? "mock-provider-id",
  );

  return AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    contextLength,
    features,
    name: options.name ?? "Mock Model",
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
