import { type AIGatewayModel } from "../schemas/model";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { type ModelCache } from "./model-cache";

/**
 * The model record a provider's own id refers to, from the cache only.
 *
 * Deliberately no network fetch, unlike `fetchModel`. The caller is a response
 * already in flight naming a model it was not asked about, and a provider round
 * trip there would put a request in the middle of streaming an answer to pay
 * for a display name. A miss is an ordinary outcome: the id itself is still the
 * truth, and everything reading this treats "no record" as "show the id".
 */
export function findCachedModelByProviderId({
  configs,
  modelCache,
  providerConfigId,
  providerId,
}: {
  configs: AIGatewayProviderConfig.Type[];
  modelCache: ModelCache;
  providerConfigId: string;
  providerId: string;
}): AIGatewayModel.Type | undefined {
  const config = configs.find((c) => c.id === providerConfigId);
  if (!config) {
    return;
  }

  return modelCache
    .read(config.cacheIdentifier)
    ?.find((model) => model.providerId === providerId);
}
