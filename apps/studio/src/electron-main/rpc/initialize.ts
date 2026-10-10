import { logger } from "@/electron-main/lib/electron-logger";
import { isExpectedNetworkError } from "@instrument-org/shared";
import {
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";
import { EventEmitter } from "node:events";

import { captureServerException } from "../lib/capture-server-exception";
import { type AppUpdaterHandle } from "../lib/create-app-updater";
import { type InitialRPCContext } from "./context";
import { createErrorClientInterceptor } from "./error-interceptor";
import { router } from "./routes";

// We expect more than the default of 10 active listeners
// due to long-lived message port subscriptions.
// Increased from the default of 10.
EventEmitter.defaultMaxListeners = 100;

// A folder listing asked for at a path that names a file or nothing at all
// is an answer the typed-path field opens the file for, or offers nothing
// for, not a bug. Rethrow for the client, skip the capture.
function isHandledFolderAnswer(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    (error.code === "NOT_A_FOLDER" || error.code === "NOT_FOUND")
  );
}

// INVALID_INPUT is input the person typed and the app refused (e.g. a topic
// name with a character Windows forbids in a file name). The UI shows it by the
// field, so it is theirs to fix rather than a bug; rethrow, skip the capture.
function isHandledInvalidInput(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "INVALID_INPUT";
}

// Clicking a link with a malformed or non-allowlisted-protocol URL (often
// agent-generated markdown) makes openExternalLink throw INVALID_URL. The client
// handles it as control flow (toasts and copies the URL to the clipboard), and
// openExternal already captures the block itself and logs the offending URL
// locally. Capturing the generic typed error here too is redundant,
// non-actionable noise, so we rethrow but skip the capture.
function isHandledInvalidUrl(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "INVALID_URL";
}

// NOT_FOUND is a defined error code that every consumer is expected to handle as
// control flow (e.g. a task or file deleted on disk while the window still
// shows it). Capturing it floods telemetry with non-actionable noise, so we
// still rethrow it to the client but skip the exception capture.
function isHandledNotFound(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "NOT_FOUND";
}

// Opening a file can fail for user-environment reasons (no app associated with
// the type, app removed) rather than an app bug. Like NOT_FOUND we still
// rethrow so the UI can toast, but skip the exception capture to avoid noise.
function isHandledOpenError(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "ERROR_OPENING_FILE";
}

// UNAUTHORIZED means signed out, developer mode off, or a provider refusing the
// key or URL the person typed in. The UI shows it, and a rejected provider key
// is already counted as a `provider.verification_failed` event; rethrow, skip
// the capture.
function isHandledUnauthorized(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

// A platform API route that answers 5xx failed on the server, which reports its
// own errors; the copy Studio would capture adds nothing it can act on. The
// route wraps the client's error as API_ERROR, so the status is on the cause.
function isPlatformApiServerError(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    error.code === "API_ERROR" &&
    error.cause instanceof ORPCError &&
    error.cause.status >= 500
  );
}

// Offline / unreachable-server failures (fetch failed, connection timeouts, DNS
// errors) reflect the user's network rather than an app bug. Like NOT_FOUND we
// still rethrow them to the client so the UI can show a retry, but skip the
// exception capture so telemetry isn't flooded with non-actionable noise.
function shouldSkipCapture(error: unknown): boolean {
  return (
    isHandledNotFound(error) ||
    isHandledUnauthorized(error) ||
    isHandledFolderAnswer(error) ||
    isHandledOpenError(error) ||
    isHandledInvalidUrl(error) ||
    isHandledInvalidInput(error) ||
    isPlatformApiServerError(error) ||
    isExpectedNetworkError(error)
  );
}

const handler = new RPCHandler<InitialRPCContext>(router, {
  clientInterceptors: [
    createErrorClientInterceptor({
      onAsyncIteratorError: (e, options) => {
        if (!shouldSkipCapture(e)) {
          captureServerException(e, {
            rpc_path: options.path,
            scopes: ["rpc"],
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
        if (!shouldSkipCapture(e)) {
          captureServerException(e, {
            rpc_path: options.path,
            scopes: ["rpc"],
          });
        }
        throw e;
      },
    }),
  ],
});

export function initializeRPC({
  appUpdater,
  workspaceConfig,
  workspaceRef,
}: {
  appUpdater: AppUpdaterHandle;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
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
        workspaceConfig,
        workspaceRef,
      },
    });
    serverPort.start();
  });
}
