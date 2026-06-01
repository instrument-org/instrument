import { Result } from "typescript-result";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { TypedError } from "../errors";
import { fetchJson } from "../fetch-json";
import { baseURLWithDefault } from "../providers/base-url-with-default";
import { setProviderAuthHeaders } from "../providers/set-auth-headers";
import {
  parseWorkersAiOpenAiCompatBaseUrl,
  workersAiModelsSearchUrl,
} from "./parse-workers-ai-base-url";
import {
  parseWorkersAiModelsList,
  parseWorkersAiModelsSearchPage,
} from "./parse-workers-ai-models";

/** Task name for chat models in the Workers AI models/search API. */
export const workersAiTextGenerationTask = "Text Generation";

const workersAiModelsSearchPageSize = 100;

type MinimalProviderConfig = Pick<
  AIGatewayProviderConfig.Type,
  "apiKey" | "baseURL" | "type"
>;

interface WorkersAiModelsSearchQuery {
  hide_experimental?: boolean;
  page?: number;
  per_page?: number;
  task?: string;
}

export function fetchAndParseWorkersAiModels(
  config: AIGatewayProviderConfig.Type,
) {
  return Result.gen(async function* () {
    const models = yield* await fetchAllWorkersAiModelsSearch(config);
    const parsed = yield* parseWorkersAiModelsList({ config, models });

    return Result.ok(parsed.toSorted((a, b) => a.name.localeCompare(b.name)));
  });
}

export function verifyWorkersAiApiKey(config: MinimalProviderConfig) {
  return workersAiModelsSearch(
    config,
    {
      hide_experimental: true,
      per_page: 1,
      task: workersAiTextGenerationTask,
    },
    { cache: false },
  ).map(() => true as const);
}

function fetchAllWorkersAiModelsSearch(
  config: MinimalProviderConfig,
  { cache = true }: { cache?: boolean } = {},
) {
  return Result.gen(async function* () {
    const allModels = [];
    let page = 1;

    while (true) {
      const pageModels = yield* await workersAiModelsSearch(
        config,
        {
          page,
          per_page: workersAiModelsSearchPageSize,
          task: workersAiTextGenerationTask,
        },
        { cache },
      );

      allModels.push(...pageModels);

      if (pageModels.length < workersAiModelsSearchPageSize) {
        break;
      }

      page += 1;
    }

    return Result.ok(allModels);
  });
}

function workersAiModelsSearch(
  config: MinimalProviderConfig,
  query: WorkersAiModelsSearchQuery,
  { cache = true }: { cache?: boolean } = {},
) {
  return Result.gen(async function* () {
    const ctx = yield* workersAiRequestContext(config);

    const result = yield* await fetchJson({
      cache,
      headers: ctx.headers,
      url: workersAiModelsSearchUrl(ctx.accountId, query),
    });

    return yield* parseWorkersAiModelsSearchPage(result);
  });
}

function workersAiRequestContext(config: MinimalProviderConfig) {
  const baseURL = baseURLWithDefault(config);
  if (!baseURL) {
    return Result.error(
      new TypedError.Fetch("Workers AI base URL is required"),
    );
  }

  const parsed = parseWorkersAiOpenAiCompatBaseUrl(baseURL);
  if (!parsed) {
    return Result.error(
      new TypedError.Fetch(
        "Workers AI base URL is not a valid OpenAI-compat URL",
      ),
    );
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  setProviderAuthHeaders(headers, config);

  return Result.ok({ accountId: parsed.accountId, headers });
}
