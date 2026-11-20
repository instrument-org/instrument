import { logger } from "@/electron-main/lib/electron-logger";
import { getWorkspaceRun } from "@/electron-main/lib/workspace-run";
import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain, type MessagePortMain, type WebContents } from "electron";
import { EventEmitter } from "node:events";

import { recordPersonAction } from "../lib/actions";
import { breadcrumbRPC } from "../lib/breadcrumbs";
import { captureServerException } from "../lib/capture-server-exception";
import { trackRPCForStalls } from "../lib/main-thread-stalls";
import { meterRPCPayloads } from "../lib/rpc-payloads";
import { type AppUpdaterHandle } from "../lib/create-app-updater";
import { type InitialRPCContext } from "./context";
import { createErrorClientInterceptor } from "./error-interceptor";
import { actionsOfCall } from "./person-actions";
import { isReportableRPCError } from "./report-policy";
import { router } from "./routes";

// We expect more than the default of 10 active listeners
// due to long-lived message port subscriptions.
// Increased from the default of 10.
EventEmitter.defaultMaxListeners = 100;

/**
 * An oRPC interceptor that records, once a call has succeeded, what the
 * person did by it, for the calls `actionsOfCall` names.
 */
async function recordPersonActions<T>(options: {
  input: unknown;
  next: () => Promise<T>;
  path: readonly string[];
}): Promise<T> {
  const output = await options.next();
  for (const action of actionsOfCall(options.path, options.input, output)) {
    recordPersonAction(action);
  }
  return output;
}

const handler = new RPCHandler<InitialRPCContext>(router, {
  clientInterceptors: [
    trackRPCForStalls,
    breadcrumbRPC,
    recordPersonActions,
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

/** Set by `initializeRPC`; until then a window's port waits in `early`. */
let appUpdater: AppUpdaterHandle | null = null;
const early: { port: MessagePortMain; sender: WebContents }[] = [];

// Listened for as the module loads, ahead of anything that can open a
// window: a handshake no one listens for is dropped, and the window's port
// closes under it once the main process lets its end go.
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

  if (appUpdater === null) {
    early.push({ port: serverPort, sender: event.sender });
    return;
  }
  connect(serverPort, event.sender.id, appUpdater);
});

/**
 * Opens the router to a window's port, with the running workspace in its
 * context, or the stand-ins for a window that connects before the workspace
 * starts.
 */
function connect(
  serverPort: MessagePortMain,
  webContentsId: number,
  updater: AppUpdaterHandle,
) {
  const run = getWorkspaceRun();

  meterRPCPayloads(serverPort, webContentsId);
  // Said whatever closed it, since the page reloading or closing looks the
  // same from here as a port lost under a page still open, which the
  // window's own report tells apart.
  serverPort.on("close", () => {
    logger.scope("rpc").info(`Window ${webContentsId}'s RPC port closed`);
  });
  handler.upgrade(serverPort, {
    context: {
      appUpdater: updater,
      webContentsId,
      ...(run.kind === "started"
        ? {
            workspaceConfig: run.workspaceConfig,
            workspaceRef: run.workspaceRef,
          }
        : {
            workspaceConfig: notStarted<WorkspaceConfig>(),
            workspaceRef: notStarted<WorkspaceActorRef>(),
          }),
    },
  });
  serverPort.start();
}

/**
 * Opens the router to each window that connects from here on, and to any
 * that connected while boot had yet to get here.
 */
export function initializeRPC({
  appUpdater: updater,
}: {
  appUpdater: AppUpdaterHandle;
}) {
  appUpdater = updater;
  for (const { port, sender } of early.splice(0)) {
    if (sender.isDestroyed()) {
      port.close();
    } else {
      connect(port, sender.id, updater);
    }
  }
}
