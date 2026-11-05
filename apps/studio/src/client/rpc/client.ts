import { OFFER_SNAPSHOT_OPTIONS } from "@/client/lib/billing-offer-snapshot";
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

// A request only a server can answer waits out being offline, unlike one this
// computer answers (`local-rpc-defaults.ts`): trying could only replace what
// the window shows with a failure, or cache an empty answer as the server's.
const REMOTE = { networkMode: "online" } as const;

export const rpcClient = createTanstackQueryUtils(baseClient, {
  // retry: 3 below are to because our default retry is 0 because most RPC calls
  // are local and won't fix if we retry. These requests ARE remote.
  experimental_defaults: {
    billing: {
      offer: {
        queryOptions: {
          ...REMOTE,
          ...OFFER_SNAPSHOT_OPTIONS,
          // Kept with no one reading it, so a sheet opened long after the
          // window's prefetch has the server's answer, not the snapshot.
          gcTime: Number.POSITIVE_INFINITY,
          retry: 3,
        },
      },
      status: { queryOptions: REMOTE },
    },
    browser: { searchSuggestions: { queryOptions: REMOTE } },
    providerConfig: { credits: { queryOptions: REMOTE } },
    releases: {
      list: {
        queryOptions: {
          ...REMOTE,
          retry: 3,
        },
      },
      notesFor: { queryOptions: REMOTE },
    },
  },
});

export type RPCInput = InferRouterInputs<typeof router>;
export type RPCOutput = InferRouterOutputs<typeof router>;
