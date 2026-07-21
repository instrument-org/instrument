import { APP_NAME, APP_URL } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";

const OPENROUTER_APP_CATEGORIES = "personal-agent,general-chat";

export function setAttributionHeaders(
  headers: Headers,
  providerType: AIGatewayProviderConfig.Type["type"],
) {
  headers.set("X-Title", APP_NAME);
  headers.set("HTTP-Referer", APP_URL);

  if (providerType === "openrouter") {
    headers.set("X-OpenRouter-Categories", OPENROUTER_APP_CATEGORIES);
    headers.set("X-OpenRouter-Title", APP_NAME);
  }
}
