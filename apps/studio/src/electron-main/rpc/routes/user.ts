import {
  platformApiQueryClient,
  platformApiRpcClient,
} from "@/electron-main/platform-api/client";
import { hasToken } from "@/electron-main/platform-api/utils";
import { base } from "@/electron-main/rpc/base";
import { createAuthenticatedLiveQuery } from "@/electron-main/rpc/lib/create-authenticated-live-query";
import { getProviderConfigsStore } from "@/electron-main/stores/provider-configs";
import { z } from "zod";

const hasAIProviderConfig = base.handler(() => {
  const providersStore = getProviderConfigsStore();
  const providerConfigs = providersStore.get("providers");
  const hasConfig = providerConfigs.length > 0;
  return hasToken() || hasConfig;
});

const me = base.handler(async () => {
  if (!hasToken()) {
    return null;
  }
  return platformApiQueryClient.fetchQuery(
    platformApiRpcClient.users.getMe.queryOptions(),
  );
});

const live = {
  me: base
    .input(z.object({ staleTime: z.number().optional().default(30_000) }))
    .handler(async function* ({ errors, input, signal }) {
      try {
        yield* createAuthenticatedLiveQuery({
          getOptions: (enabled) =>
            platformApiRpcClient.users.getMe.queryOptions({
              enabled,
              staleTime: input.staleTime,
            }),
          queryKey: platformApiRpcClient.users.getMe.queryKey(),
          signal,
        });
      } catch (error) {
        throw errors.API_ERROR({
          cause: error,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
  subscriptionStatus: base
    .input(z.object({ staleTime: z.number().optional().default(30_000) }))
    .handler(async function* ({ errors, input, signal }) {
      try {
        yield* createAuthenticatedLiveQuery({
          getOptions: (enabled) =>
            platformApiRpcClient.users.getSubscriptionStatus.queryOptions({
              enabled,
              staleTime: input.staleTime,
            }),
          queryKey: platformApiRpcClient.users.getSubscriptionStatus.queryKey(),
          signal,
        });
      } catch (error) {
        throw errors.API_ERROR({
          cause: error,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
};

export const user = {
  hasAIProviderConfig,
  live,
  me,
};
