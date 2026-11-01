import { type router } from "@/electron-main/rpc/routes";
import { phoneHost } from "@/client/lib/phone-host";
import { createORPCClient } from "@orpc/client";
import { RPCLink as MessagePortRPCLink } from "@orpc/client/message-port";
import { RPCLink as WebSocketRPCLink } from "@orpc/client/websocket";
import {
  type InferRouterInputs,
  type InferRouterOutputs,
  type RouterClient,
} from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

/**
 * The way to main's router: over the message port the preload opens for the
 * window, or over one WebSocket to the phone host where this page runs on
 * another device.
 */
function createLink() {
  const phone = phoneHost();
  if (phone) {
    const address = new URL("/rpc", phone.origin.replace(/^http/, "ws"));
    address.searchParams.set("token", phone.token);
    return new WebSocketRPCLink({ websocket: new WebSocket(address) });
  }
  const { port1: clientPort, port2: serverPort } = new MessageChannel();
  window.postMessage("start-orpc-client", "*", [serverPort]);
  const link = new MessagePortRPCLink({
    port: clientPort,
  });
  clientPort.start();
  return link;
}

const baseClient: RouterClient<typeof router> = createORPCClient(createLink());
export const rpcClient = createTanstackQueryUtils(baseClient, {
  // retry: 3 below are to because our default retry is 0 because most RPC calls
  // are local and won't fix if we retry. These requests ARE remote.
  experimental_defaults: {
    billing: {
      offer: {
        queryOptions: {
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
