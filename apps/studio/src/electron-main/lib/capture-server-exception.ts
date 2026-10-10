import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { isPlatformApiUnreachable } from "@/electron-main/platform-api/reachability";
import {
  type CaptureExceptionFunction,
  isExpectedNetworkError,
} from "@instrument-org/shared";

import { describeError } from "./describe-error";
import { logger } from "./electron-logger";
import { addServerException } from "./server-exceptions";

/**
 * Record an exception on this computer: the main log, and in developer mode
 * the exception list the Debug tab shows. Nothing here leaves the device.
 */
export const captureServerException: CaptureExceptionFunction = function (
  error,
  additionalProperties,
) {
  // The window's corner already says the platform API is down, and every
  // request through it (the gateway, titles, the account) fails the same way
  // until it is back.
  if (isPlatformApiUnreachable() && isExpectedNetworkError(error)) {
    return;
  }
  const code: unknown =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  // ORPC names its own failures with a string code; a provider puts the
  // upstream HTTP status here as a number. Both say what the failure was.
  const errorCode =
    typeof code === "string"
      ? code
      : typeof code === "number"
        ? String(code)
        : undefined;

  // Extract additional error data from ORPC (e.g., validation issues from BAD_REQUEST)
  const errorData =
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data !== undefined
      ? error.data
      : undefined;

  const { details, message } = describeError(error);
  if (isDeveloperMode()) {
    const pathPrefix = additionalProperties?.rpc_path
      ? `[${additionalProperties.rpc_path.join(".")}] `
      : "";
    const displayMessage = errorCode
      ? `${pathPrefix}[${errorCode}] ${message}`
      : `${pathPrefix}${message}`;

    // One entry, so the dev log keeps the heading, cause, and data together.
    const cause =
      error instanceof Error && error.cause
        ? describeError(error.cause)
        : undefined;
    logger.error(
      `[Exception] ${displayMessage}`,
      ...(details ? [details] : []),
      ...(cause ? [`Cause: ${cause.details ?? cause.message}`] : []),
      // e.g. validation issues
      ...(errorData ? [errorData] : []),
    );

    addServerException({
      code: errorCode,
      details,
      message,
      rpcPath: additionalProperties?.rpc_path
        ? additionalProperties.rpc_path.join(".")
        : undefined,
    });
  } else {
    logger.error(error);
  }
};
