import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { baseURLWithDefault } from "../providers/base-url-with-default";

const WORKERS_AI_OPENAI_COMPAT_BASE_URL_PATTERN =
  /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([^/]+)\/ai\/v1\/?$/;

export function isWorkersAiProviderConfig(
  config: Pick<AIGatewayProviderConfig.Type, "baseURL" | "type">,
) {
  const baseURL = baseURLWithDefault(config);
  if (!baseURL) {
    return false;
  }

  return parseWorkersAiOpenAiCompatBaseUrl(baseURL) !== null;
}

export function parseWorkersAiOpenAiCompatBaseUrl(baseURL: string) {
  const normalized = baseURL.trim().replace(/\/$/, "");
  const match = WORKERS_AI_OPENAI_COMPAT_BASE_URL_PATTERN.exec(normalized);
  if (!match?.[1]) {
    return null;
  }

  return { accountId: match[1] };
}

export function workersAiModelsSearchUrl(
  accountId: string,
  {
    hide_experimental,
    page,
    per_page,
    task,
  }: {
    hide_experimental?: boolean;
    page?: number;
    per_page?: number;
    task?: string;
  } = {},
) {
  const searchParams = new URLSearchParams({ format: "openrouter" });

  if (task) {
    searchParams.set("task", task);
  }
  if (hide_experimental) {
    searchParams.set("hide_experimental", "true");
  }
  if (page !== undefined && page > 1) {
    searchParams.set("page", String(page));
  }
  if (per_page !== undefined) {
    searchParams.set("per_page", String(per_page));
  }

  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?${searchParams.toString()}`;
}
