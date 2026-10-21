import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

import { type SessionMessage } from "../schemas/session/message";
import { gatewayResponseBodySchema } from "./gateway-response-body";
import { platformCodeSchema } from "./platform-code";

type ErrorAction =
  | { error: Error; type: "error" }
  | { type: "continue" }
  | { type: "retry" }
  | { type: "stop" }
  | { type: "wait" };

/**
 * Our platform turning a request away because too many of the user's own
 * requests are running at once. It clears when one of them finishes, which can
 * take minutes rather than the seconds a retry's backoff allows for.
 */
function isOurConcurrencyLimit(message: SessionMessage.Assistant) {
  const error = message.metadata.error;
  if (
    error?.kind !== "api-call" ||
    !error.responseBody ||
    message.metadata.aiGatewayModel?.params.provider !==
      OUR_PROVIDER_CONFIG.type
  ) {
    return false;
  }
  const result = platformCodeSchema.safeParse(error.responseBody);
  return result.success && result.data.error.code === "concurrency-limit";
}

export function getErrorAction(message: SessionMessage.Assistant): ErrorAction {
  const error = message.metadata.error;
  if (!error) {
    return { type: "continue" };
  }

  if (isOurConcurrencyLimit(message)) {
    return { type: "wait" };
  }

  // Retrying cannot help until the user frees space.
  if (error.kind === "aborted" || error.kind === "disk-full") {
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

  // A refused credential or a spent plan allowance answers every retry the
  // same way; the user has to act before the next request can work.
  if (classification === "auth" || classification === "usage-limit") {
    return { type: "stop" };
  }

  // Content the provider refused goes out byte for byte on a retry and is
  // refused again. Stopping leaves the error on the message for the user.
  if (classification === "unsendable-content") {
    return { type: "stop" };
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
