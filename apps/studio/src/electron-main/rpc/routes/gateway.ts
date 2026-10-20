import { liveRead } from "@instrument-org/workspace/electron";
import { refreshExpiredTokens } from "@/electron-main/lib/chatgpt-account";
import { claudeAccountStatusKnown } from "@/electron-main/lib/claude-account";
import { refreshExpiredGrokTokens } from "@/electron-main/lib/grok-account";
import { base } from "@/electron-main/rpc/base";
import {
  AIGatewayModel,
  AIGatewayProviderConfig,
  fetchModelResultsForProviders,
  type ModelRoutes,
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
  /**
   * This computer's connections in the order added, and the routes it
   * settled on for models other computers chose: what `routeModel` reads,
   * so the composer reaches a stored model the way the send does.
   */
  connections: z.array(
    AIGatewayProviderConfig.Schema.pick({ id: true, type: true }),
  ),
  routes: z.record(z.string(), z.string()),
});

type ListErrors = z.output<typeof ListSchema>["errors"];

/** What the list says about this computer, beside the models. */
function routing(
  providers: AIGatewayProviderConfig.Type[],
  routes: ModelRoutes | undefined,
) {
  return {
    connections: providers.map(({ id, type }) => ({ id, type })),
    routes: { ...routes?.read() },
  };
}

const list = base
  .errors({
    FETCH_ERROR: {},
    PARSE_ERROR: {},
  })
  .output(ListSchema)
  .handler(async ({ context }) => {
    await Promise.all([
      refreshExpiredTokens(),
      refreshExpiredGrokTokens(),
      claudeAccountStatusKnown(),
    ]);
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

    return {
      errors,
      models,
      ...routing(providers, context.workspaceConfig.modelRoutes),
    };
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
      publisher.subscribe("model-routes.updated", { signal }),
    ];

    // Claude's provider config depends on the CLI's first sign-in check.
    // Until it finishes, even a warm cache would omit the account's models.
    await claudeAccountStatusKnown();

    // Serve stale cached models while the fresh fetch runs.
    const providers = context.workspaceConfig.getAIProviderConfigs();
    const cachedModels = providers.flatMap(
      (config) =>
        context.workspaceConfig.modelCache.read(config.cacheIdentifier) ?? [],
    );
    if (cachedModels.length > 0) {
      yield {
        errors: [],
        models: cachedModels,
        ...routing(providers, context.workspaceConfig.modelRoutes),
      };
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
