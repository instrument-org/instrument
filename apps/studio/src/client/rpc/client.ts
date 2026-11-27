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
// The server's answer can change at any time, so a mount reads it again.
const REMOTE = { networkMode: "online", staleTime: 0 } as const;

// Read again on each mount: what these answer changes with nothing in the app
// to invalidate them, where a one-shot read otherwise stays as first read
// (`local-rpc-defaults.ts`).
const ON_EACH_MOUNT = { queryOptions: { staleTime: 0 } } as const;

export const rpcClient = createTanstackQueryUtils(baseClient, {
  // retry: 3 below are to because our default retry is 0 because most RPC calls
  // are local and won't fix if we retry. These requests ARE remote.
  experimental_defaults: {
    // Sites visited since the Apps page last opened.
    apps: { fromBrowser: ON_EACH_MOUNT },
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
    // Whether a capture's original is still there, and the captures taken
    // in other windows (developer tools).
    captures: { hasOriginal: ON_EACH_MOUNT, list: ON_EACH_MOUNT },
    // A folder that grew, a file rewritten at the same path.
    files: { folderSize: ON_EACH_MOUNT, probeMedia: ON_EACH_MOUNT },
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
    // The log's tail, each time the viewer opens.
    utils: { readDiagnosticLog: ON_EACH_MOUNT },
    workspace: {
      // Files moved or trashed outside the app, a page's title rewritten.
      computer: { describe: ON_EACH_MOUNT, titles: ON_EACH_MOUNT },
      // An AI app installed since.
      memory: { sources: ON_EACH_MOUNT },
      // Matches in messages that arrived since Find last searched the text.
      message: { find: ON_EACH_MOUNT },
      // Folders granted from a chat's card, and what macOS allows since
      // System Settings.
      permissions: { get: ON_EACH_MOUNT, macos: ON_EACH_MOUNT },
      // Zoom, kept outside the preferences that key the query.
      settings: { values: ON_EACH_MOUNT },
      // Skills in home folders no watch covers.
      skill: { list: ON_EACH_MOUNT },
      // An office download an agent made, a broken chat folder another window
      // trashed or a sync brought in.
      storage: {
        invalidFolders: { list: ON_EACH_MOUNT },
        office: { get: ON_EACH_MOUNT },
      },
    },
    // A workspace's size as it grows (developer tools).
    workspaces: { sizes: ON_EACH_MOUNT },
  },
});

export type RPCInput = InferRouterInputs<typeof router>;
export type RPCOutput = InferRouterOutputs<typeof router>;
