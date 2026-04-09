import { APP_CLIENT_NAME_STUDIO } from "@instrument-org/shared";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { DedupeRequestsPlugin } from "@orpc/client/plugins";
import {
  type ContractRouterClient,
  type InferContractRouterOutputs,
} from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import { app } from "electron";
import { isEqual } from "radashi";

import { type contract } from "./contract";
import { PATHS_TO_DEDUPE } from "./paths-to-dedupe";
import { getToken } from "./utils";

const RPC_LINK = new RPCLink({
  headers: () => {
    const token = getToken();
    const version = app.getVersion();
    const baseHeaders = {
      "x-client-name": APP_CLIENT_NAME_STUDIO,
      "x-client-platform": process.platform,
      "x-client-version": version,
    };
    if (!token) {
      return baseHeaders;
    }
    return {
      ...baseHeaders,
      authorization: `Bearer ${token}`,
    };
  },
  plugins: [
    new DedupeRequestsPlugin({
      filter: ({ path }) => {
        return PATHS_TO_DEDUPE.some((rpcPath) => isEqual(rpcPath, path));
      },
      groups: [
        {
          condition: () => true,
          context: {},
        },
      ],
    }),
  ],
  url: `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/rpc`,
});

const baseClient: ContractRouterClient<typeof contract> =
  createORPCClient(RPC_LINK);
export const platformApiRpcClient = createTanstackQueryUtils(baseClient);

export type Subscription = Outputs["users"]["getSubscriptionStatus"];
type Outputs = InferContractRouterOutputs<typeof contract>;

export const platformApiQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});
