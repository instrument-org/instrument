import { APP_NAME } from "@instrument-org/shared";
import { app, dialog } from "electron";

import { captureServerException } from "./capture-server-exception";
import { describeError } from "./describe-error";

/**
 * A boot that cannot finish must end the process, visibly. The bootstrap
 * promise has no other consumer: left unhandled, its rejection is suppressed
 * by the crash diagnostics' unhandledRejection handler and the app keeps
 * running with no window -- unreachable outside macOS, and holding the
 * single-instance lock so every relaunch is a no-op. So record the failure,
 * say what it was, and exit, which releases the lock so a relaunch actually
 * retries. `showErrorBox` blocks until dismissed, so the exit waits for the
 * user to have seen the message.
 */
export function handleBootFailure(error: unknown): void {
  captureServerException(error, { scopes: ["studio"] });

  const { message } = describeError(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const detail =
    cause === undefined
      ? message
      : `${message}: ${describeError(cause).message}`;
  dialog.showErrorBox(`${APP_NAME} could not start`, detail);

  app.exit(1);
}
