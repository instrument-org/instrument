import { liveRead } from "@instrument-org/workspace/electron";
import { refreshExpiredTokens } from "@/electron-main/lib/chatgpt-plan";
import { base } from "@/electron-main/rpc/base";
import {
  AIGatewayModel,
  AIGatewayProviderConfig,
  fetchModelResultsForProviders,
} from "@instrument-org/ai-gateway";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { publisher } from "../publisher";

const ListSchema = z.object({
  errors: z.array(
    z.object({
      config: AIGatewayProviderConfig.Schema.pick({
        displayName: true,
        id: true,
        type: true,
      }),
      message: z.string(),
    }),
  ),
  models: z.array(AIGatewayModel.Schema),
});

type ListErrors = z.output<typeof ListSchema>["errors"];

const list = base
  .errors({
    FETCH_ERROR: {},
    PARSE_ERROR: {},
  })
  .output(ListSchema)
  .handler(async ({ context }) => {
    await refreshExpiredTokens();
    const providers = context.workspaceConfig.getAIProviderConfigs();
    const modelsForProviders = await fetchModelResultsForProviders(providers, {
      captureException: context.workspaceConfig.captureException,
      modelCache: context.workspaceConfig.modelCache,
    });

    const errors: ListErrors = [];
    const models: AIGatewayModel.Type[] = [];

    for (const modelResults of modelsForProviders) {
      if (modelResults.ok) {
        models.push(...modelResults.value);
      } else {
        errors.push({
          config: modelResults.error.config,
          message: modelResults.error.message,
        });
      }
    }

    return { errors, models };
  });

const live = {
  list: base.output(eventIterator(ListSchema)).handler(async function* ({
    context,
    signal,
  }) {
    // Subscribed before anything is read, so a change that lands while the
    // cached or fresh list is on its way is read again rather than lost.
    const changes = [
      publisher.subscribe("provider-config.updated", { signal }),
      publisher.subscribe("session.apiBearerToken.updated", { signal }),
    ];

    // Serve stale cached models immediately while the fresh fetch runs.
    const providers = context.workspaceConfig.getAIProviderConfigs();
    const cachedModels = providers.flatMap(
      (config) =>
        context.workspaceConfig.modelCache.read(config.cacheIdentifier) ?? [],
    );
    if (cachedModels.length > 0) {
      yield { errors: [], models: cachedModels };
    }

    // Fetch fresh data. fetchModelsForProvider writes to cache on success.
    yield* liveRead({
      changes,
      read: () => call(list, {}, { context, signal }),
    });
  }),
};

const models = {
  list,
  live,
};

export const gateway = {
  models,
};
