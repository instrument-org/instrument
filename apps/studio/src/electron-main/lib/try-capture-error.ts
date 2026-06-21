import { Result } from "typescript-result";

import { captureServerException } from "./capture-server-exception";

/**
 * Calls `op`, captures any thrown error as a `Result`, logs it, and reports it
 * via captureServerException. Returns the `Result` so callers can inspect or
 * react to failures if needed -- safe to ignore when you just want fire-and-forget.
 */
export function tryCaptureError<T>(
  message: string,
  op: () => T,
): Result<T, Error> {
  const result = Result.try(op, (err) => new Error(message, { cause: err }));
  if (!result.ok) {
    captureServerException(result.error, { scopes: ["studio"] });
  }
  return result;
}
