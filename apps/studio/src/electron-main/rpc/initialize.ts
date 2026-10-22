import { logger } from "@/electron-main/lib/electron-logger";
import {
  getStartedWorkspace,
  isWorkspaceStarted,
  type StartedWorkspace,
} from "@/electron-main/lib/started-workspace";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";
import { EventEmitter } from "node:events";

import { breadcrumbRPC } from "../lib/breadcrumbs";
import { captureServerException } from "../lib/capture-server-exception";
import { trackRPCForStalls } from "../lib/main-thread-stalls";
import { type AppUpdaterHandle } from "../lib/create-app-updater";
import { type InitialRPCContext } from "./context";
import { createErrorClientInterceptor } from "./error-interceptor";
import { isReportableRPCError } from "./report-policy";
import { router } from "./routes";

// We expect more than the default of 10 active listeners
// due to long-lived message port subscriptions.
// Increased from the default of 10.
EventEmitter.defaultMaxListeners = 100;

const handler = new RPCHandler<InitialRPCContext>(router, {
  clientInterceptors: [
    trackRPCForStalls,
    breadcrumbRPC,
    createErrorClientInterceptor({
      onAsyncIteratorError: (e, options) => {
        if (isReportableRPCError(e)) {
          captureServerException(e, {
            mechanism: "rpc",
            rpcPath: options.path.join("."),
          });
        }
        throw e;
      },
      onError: (e, options) => {
        // DON'T treat aborted signal as error - the client disconnected
        // intentionally (e.g. navigated away, query input changed).
        if (options.signal?.aborted && options.signal.reason === e) {
          throw e;
        }
        if (isReportableRPCError(e)) {
          captureServerException(e, {
            mechanism: "rpc",
            rpcPath: options.path.join("."),
          });
        }
        throw e;
      },
    }),
  ],
});

/**
 * A stand-in for a part of the workspace a connection made before it
 * started can't reach, which throws on any use. A first launch's window
 * connects before setup places the workspace, draws only setup, and reloads
 * once the workspace runs, so nothing it asks for reaches one of these.
 */
function notStarted<T extends object>(): T {
  // Typed as the part it stands in for: no route that reads one gets past
  // its first property.
  return new Proxy({} as T, {
    get: () => {
      throw new Error("The workspace was asked for before it started");
    },
  });
}

/**
 * Opens the router to each window that connects, with the running workspace
 * in its context, or the stand-ins for a window that connects before the
 * workspace starts.
 */
export function initializeRPC({
  appUpdater,
}: {
  appUpdater: AppUpdaterHandle;
}) {
  ipcMain.on("start-orpc-server", (event) => {
    // The port handshake is the renderer's one route to the whole router, so
    // only the top frame gets to open it. Preload is the sole sender and today
    // it loads in the main frame alone (`nodeIntegrationInSubFrames` is off),
    // which makes this inert -- it is here so enabling that flag later cannot
    // quietly hand embedded content a channel to the main process.
    if (event.senderFrame !== event.sender.mainFrame) {
      logger.scope("rpc").error("Ignoring RPC port from a subframe");
      return;
    }

    const [serverPort] = event.ports;

    if (!serverPort) {
      logger.scope("rpc").error("No server port found");
      return;
    }

    const webContentsId = event.sender.id;

    handler.upgrade(serverPort, {
      context: {
        appUpdater,
        webContentsId,
        ...(isWorkspaceStarted()
          ? getStartedWorkspace()
          : ({
              workspaceConfig: notStarted(),
              workspaceRef: notStarted(),
            } satisfies StartedWorkspace)),
      },
    });
    serverPort.start();
  });
}
