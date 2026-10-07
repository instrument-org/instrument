import { chatGPTAccountProviderConfigs } from "@/electron-main/lib/chatgpt-account";
import { claudeAccountProviderConfigs } from "@/electron-main/lib/claude-account";
import { getToken } from "@/electron-main/platform-api/utils";
import { getProviderConfigsStore } from "@/electron-main/stores/workspace/provider-configs";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

// Helper to get stored configs and add our config if the user is logged in,
// one for each ChatGPT account signed in with its plan, and the Claude account
// while the Claude Code CLI is signed in to one.
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

  keyBasedProviderConfigs.push(...chatGPTAccountProviderConfigs());
  keyBasedProviderConfigs.push(...claudeAccountProviderConfigs());

  return keyBasedProviderConfigs;
}
