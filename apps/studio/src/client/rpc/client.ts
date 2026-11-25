import { OFFER_SNAPSHOT_OPTIONS } from "@/client/lib/billing-offer-snapshot";
import { countCall } from "@/client/lib/calls-in-flight";
import { captureException } from "@/client/lib/capture-exception";
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
  interceptors: [countCall],
  port: clientPort,
});

clientPort.start();

// The port closes under a page still open only when the main process's end
// went away without it, which leaves every request unanswered from then on:
// the page loads again for a port of its own, and reports it from there
// (`reportClosedRPCPort`), since nothing can be sent over this one. Once a
// minute at most, so a port that closes again at once leaves the failure on
// screen rather than a window reloading forever.
const RELOADED_FOR_PORT_KEY = "rpc.reloadedForClosedPort";
/** Set across the reload for the page that loads to report. */
export const CLOSED_PORT_TO_REPORT_KEY = "rpc.closedPortToReport";
const RELOAD_SPACING_MS = 60_000;
clientPort.addEventListener("close", () => {
  const last = Number(sessionStorage.getItem(RELOADED_FOR_PORT_KEY));
  if (Date.now() - last <= RELOAD_SPACING_MS) {
    captureException(
      new Error(
        "The window's RPC port closed again within a minute of a reload",
      ),
    );
    return;
  }
  sessionStorage.setItem(RELOADED_FOR_PORT_KEY, String(Date.now()));
  sessionStorage.setItem(CLOSED_PORT_TO_REPORT_KEY, "1");
  location.reload();
});

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
