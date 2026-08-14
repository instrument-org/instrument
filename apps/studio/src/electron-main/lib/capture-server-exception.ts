import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { app } from "electron";
import { unique } from "radashi";

import { getAppStateStore } from "../stores/app-state";
import { isDeveloperMode } from "../stores/preferences";
import { describeError } from "./describe-error";
import { logger } from "./electron-logger";
import { addServerException } from "./server-exceptions";
import { getSystemProperties } from "./system-properties";
import { telemetry } from "./telemetry";

export const captureServerException: CaptureExceptionFunction = function (
  error,
  additionalProperties,
) {
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

  const finalProperties = {
    ...additionalProperties,
    $process_person_profile: false, // Ensure anonymous, if at all
    scopes: unique(["studio", ...(additionalProperties?.scopes ?? [])]),
    version: app.getVersion(),
    ...getSystemProperties(),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(errorData ? { error_data: errorData } : {}),
    // A non-`Error` has no stack to carry the rest of what it said, so the
    // serialized value rides along instead of being dropped.
    ...(error instanceof Error || details === undefined
      ? {}
      : { error_details: details }),
    ...(additionalProperties?.rpc_path
      ? { rpc_path: additionalProperties.rpc_path.join(".") }
      : {}),
  };
  // Give ORPC errors a descriptive type in PostHog (default Error.name is "Error")
  if (error instanceof Error && error.name === "Error" && errorCode) {
    error.name = errorCode;
  }

  // PostHog drops non-Error exceptions silently; wrap plain objects so we
  // always get a real stack trace, under the sentence the value carried so
  // that two reports of the same rejection group together.
  const capturedError = error instanceof Error ? error : new Error(message);

  const appStateStore = getAppStateStore();
  const telemetryId = appStateStore.get("telemetryId");
  telemetry?.captureException(capturedError, telemetryId, finalProperties);
  if (isDeveloperMode()) {
    /* eslint-disable no-console */
    const pathPrefix = additionalProperties?.rpc_path
      ? `[${additionalProperties.rpc_path.join(".")}] `
      : "";
    const displayMessage = errorCode
      ? `${pathPrefix}[${errorCode}] ${message}`
      : `${pathPrefix}${message}`;

    console.groupCollapsed(`%c[Exception] ${displayMessage}`, "color: #b71c1c");

    if (details) {
      logger.error(details);
    }

    if (error instanceof Error && error.cause) {
      const cause = describeError(error.cause);
      console.groupCollapsed("%c▶︎ Cause: " + cause.message, "color: #f44336");
      logger.error(cause.details ?? cause.message);
      console.groupEnd();
    }

    // Log additional error data if present (e.g., validation issues)
    if (errorData) {
      console.groupCollapsed("%c▶︎ Error Data", "color: #ff9800");
      logger.error(errorData);
      console.groupEnd();
    }

    console.groupEnd();

    addServerException({
      code: errorCode,
      details,
      message,
      rpcPath: additionalProperties?.rpc_path
        ? additionalProperties.rpc_path.join(".")
        : undefined,
    });
    /* eslint-enable no-console */
  } else {
    logger.error(error);
  }
};
