import { isDeveloperMode } from "@/electron-main/stores/workspace/preferences";
import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { app } from "electron";
import { unique } from "radashi";

import { getMachineState } from "../stores/machine/state";
import { describeCauses, describeError } from "./describe-error";
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
  // What the message cannot say: a wrapper reports one sentence for every way
  // the thing it wrapped can fail, and the stack ends at the wrapper too.
  const causes = describeCauses(error);

  const finalProperties = {
    ...additionalProperties,
    $process_person_profile: false, // Ensure anonymous, if at all
    scopes: unique(["studio", ...(additionalProperties?.scopes ?? [])]),
    version: app.getVersion(),
    ...getSystemProperties(),
    ...(causes ? { error_causes: causes } : {}),
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

  const telemetryId = getMachineState().get("telemetryId");
  telemetry?.captureException(capturedError, telemetryId, finalProperties);
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
