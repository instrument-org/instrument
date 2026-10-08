import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { base } from "@/electron-main/rpc/base";
import { createAuthenticatedLiveQuery } from "@/electron-main/rpc/lib/create-authenticated-live-query";
import { z } from "zod";

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
};

export const user = {
  live,
};
