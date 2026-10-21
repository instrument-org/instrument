import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { chatGPTAccountProviderConfigs } from "@/electron-main/lib/chatgpt-account";
import { claudeAccountProviderConfigs } from "@/electron-main/lib/claude-account";
import { grokAccountProviderConfigs } from "@/electron-main/lib/grok-account";
import { getToken } from "@/electron-main/platform-api/utils";
import {
  getDisabledProviderConfigIds,
  getProviderConfigsStore,
} from "@/electron-main/stores/workspace/provider-configs";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

/**
 * The connections every model path reaches: all of them but the ones turned
 * off in Settings. Anything that sends, lists or routes models reads this, so
 * a connection that is off is simply not there.
 */
export function getAIProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const disabled = getDisabledProviderConfigIds();
  return getAllAIProviderConfigs().filter(({ id }) => !disabled.has(id));
}

// Helper to get stored configs and add our config if the user is logged in,
// one for each ChatGPT account signed in with its plan, and the Claude account
// while the Claude Code CLI is signed in to one, whether turned off or not.
export function getAllAIProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const providerConfigsStore = getProviderConfigsStore();
  const keyBasedProviderConfigs = [...providerConfigsStore.get("providers")];
  const token = getToken();

  if (token) {
    keyBasedProviderConfigs.push({
      ...OUR_PROVIDER_CONFIG,
      apiKey: token,
      baseURL: `${platformApiBaseUrl()}/gateway/openrouter`,
    });
  }

  keyBasedProviderConfigs.push(...chatGPTAccountProviderConfigs());
  keyBasedProviderConfigs.push(...claudeAccountProviderConfigs());
  keyBasedProviderConfigs.push(...grokAccountProviderConfigs());

  return keyBasedProviderConfigs;
}
