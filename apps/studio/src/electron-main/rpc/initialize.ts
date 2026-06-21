import { logger } from "@/electron-main/lib/electron-logger";
import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";
import { EventEmitter } from "node:events";

import { type BrowserViewManager } from "../browser-view/manager";
import { captureServerException } from "../lib/capture-server-exception";
import { type StudioAppUpdater } from "../lib/update";
import { type InitialRPCContext } from "./context";
import { createErrorClientInterceptor } from "./error-interceptor";
import { router } from "./routes";

// We expect more than the default of 10 active listeners
// due to long-lived message port subscriptions.
// Increased from the default of 10.
EventEmitter.defaultMaxListeners = 100;

const handler = new RPCHandler<InitialRPCContext>(router, {
  clientInterceptors: [
    createErrorClientInterceptor({
      onAsyncIteratorError: (e, options) => {
        captureServerException(e, {
          rpc_path: options.path,
          scopes: ["rpc"],
        });
        throw e;
      },
      onError: (e, options) => {
        // DON'T treat aborted signal as error - the client disconnected
        // intentionally (e.g. navigated away, query input changed).
        if (options.signal?.aborted && options.signal.reason === e) {
          throw e;
        }
        captureServerException(e, {
          rpc_path: options.path,
          scopes: ["rpc"],
        });
        throw e;
      },
    }),
  ],
});

export function initializeRPC({
  appUpdater,
  browserViewManager,
  workspaceConfig,
  workspaceRef,
}: {
  appUpdater: StudioAppUpdater;
  browserViewManager: BrowserViewManager;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}) {
  ipcMain.on("start-orpc-server", (event) => {
    const [serverPort] = event.ports;

    if (!serverPort) {
      logger.scope("rpc").error("No server port found");
      return;
    }

    const webContentsId = event.sender.id;

    handler.upgrade(serverPort, {
      context: {
        appUpdater,
        browserViewManager,
        webContentsId,
        workspaceConfig,
        workspaceRef,
      },
    });
    serverPort.start();
  });
}
