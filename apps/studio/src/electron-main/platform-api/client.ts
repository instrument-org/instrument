import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { DedupeRequestsPlugin } from "@orpc/client/plugins";
import { type ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import { isEqual } from "radashi";

import { type contract } from "./contract";
import { getPlatformApiHeaders } from "./headers";
import { PATHS_TO_DEDUPE } from "./paths-to-dedupe";

const RPC_LINK = new RPCLink({
  headers: getPlatformApiHeaders,
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

export const platformApiQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});
