import { getToken } from "@/electron-main/api/utils";
import { getProviderConfigsStore } from "@/electron-main/stores/provider-configs";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

// Helper to get stored configs and add the Quests config if the user is logged in.
export function getAIProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const providerConfigsStore = getProviderConfigsStore();
  const keyBasedProviderConfigs = [...providerConfigsStore.get("providers")];
  const token = getToken();

  if (token) {
    keyBasedProviderConfigs.push({
      ...OUR_PROVIDER_CONFIG,
      apiKey: token,
      baseURL: `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/gateway/openrouter`,
    });
  }

  return keyBasedProviderConfigs;
}
