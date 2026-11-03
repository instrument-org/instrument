import { type router } from "@/electron-main/rpc/routes";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import {
  type InferRouterInputs,
  type InferRouterOutputs,
  type RouterClient,
} from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const { port1: clientPort, port2: serverPort } = new MessageChannel();

window.postMessage("start-orpc-client", "*", [serverPort]);

const link = new RPCLink({
  port: clientPort,
});

clientPort.start();

const baseClient: RouterClient<typeof router> = createORPCClient(link);
export const rpcClient = createTanstackQueryUtils(baseClient, {
  // retry: 3 below are to because our default retry is 0 because most RPC calls
  // are local and won't fix if we retry. These requests ARE remote.
  experimental_defaults: {
    billing: {
      offer: {
        queryOptions: {
          // Kept with no one reading it, so a sheet opened long after the
          // window's prefetch draws from it while it asks again.
          gcTime: Number.POSITIVE_INFINITY,
          retry: 3,
        },
      },
    },
    releases: {
      list: {
        queryOptions: {
          retry: 3,
        },
      },
    },
  },
});

export type RPCInput = InferRouterInputs<typeof router>;
export type RPCOutput = InferRouterOutputs<typeof router>;
