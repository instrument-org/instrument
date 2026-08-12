import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

import { type SessionMessage } from "../schemas/session/message";
import { gatewayResponseBodySchema } from "./gateway-response-body";

type ErrorAction =
  | { error: Error; type: "error" }
  | { type: "continue" }
  | { type: "retry" }
  | { type: "stop" };

export function getErrorAction(message: SessionMessage.Assistant): ErrorAction {
  const error = message.metadata.error;
  if (!error) {
    return { type: "continue" };
  }

  if (error.kind === "aborted") {
    return { type: "stop" };
  }

  // Waiting is the whole fix for these two, and the machine already knows how
  // to wait. Checked ahead of `kind`, which says how the rejection reached us
  // rather than what it was: an upstream throttle reported inside a 200 stream
  // is recorded as `unknown` and would otherwise end the turn on first sight.
  const classification =
    "classification" in error ? error.classification : undefined;
  if (classification === "rate-limit" || classification === "transient") {
    return { type: "retry" };
  }

  if (error.kind === "unknown") {
    return { error: new Error(error.message), type: "error" };
  }

  if (error.kind === "no-such-tool" || error.kind === "invalid-tool-input") {
    return { type: "retry" };
  }

  if (error.kind === "api-call") {
    // Check for insufficient balance errors, e.g. DeepSeek does this
    if (error.responseBody) {
      const result = gatewayResponseBodySchema.safeParse(error.responseBody);
      if (
        result.success &&
        result.data.error?.message
          ?.toLowerCase()
          .includes("insufficient balance")
      ) {
        return { type: "stop" };
      }
    }

    // For our provider, check if the response explicitly says not retryable
    if (
      message.metadata.aiGatewayModel?.params.provider ===
      OUR_PROVIDER_CONFIG.type
    ) {
      if (!error.responseBody) {
        return { type: "retry" };
      }

      const result = gatewayResponseBodySchema.safeParse(error.responseBody);
      if (!result.success) {
        return { type: "retry" };
      }

      const isRetryable = result.data.error?.retryable;

      // Only stop if the response explicitly says not retryable
      if (isRetryable === false) {
        return { type: "stop" };
      }
      return { type: "retry" };
    }

    // For other providers with API errors, default to retryable
    return { type: "retry" };
  }

  // Unknown error kind, stop to be safe
  return { type: "stop" };
}
