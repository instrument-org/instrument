import { APICallError } from "@ai-sdk/provider";
import {
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKRateLimitInfo,
} from "@anthropic-ai/claude-agent-sdk";

import { OLDEST_CLAUDE_CODE, runsClaudeCode } from "./release";

/** What reading Claude Code's output takes from the process it comes from. */
export interface MessageSource {
  readonly messages: AsyncIterator<SDKMessage, void>;
  /** The plan's usage as the CLI last reported it, which it does not repeat every turn. */
  rateLimit: SDKRateLimitInfo | undefined;
  readonly stderr: string;
}

/**
 * Claude Code's next message, past the ones every reader handles alike: a
 * report of the plan's usage is kept on the source, and the process exiting
 * or a turn ending in failure throws.
 */
export async function nextMessage(source: MessageSource): Promise<SDKMessage> {
  while (true) {
    const next = await source.messages.next();
    if (next.done) {
      throw planError("unknown", `Claude Code exited.\n${source.stderr}`);
    }
    const message = next.value;
    if (message.type === "rate_limit_event") {
      source.rateLimit = message.rate_limit_info;
      continue;
    }
    if (
      message.type === "result" &&
      (message.subtype !== "success" || message.is_error)
    ) {
      throw planError(
        "unknown",
        message.subtype === "success"
          ? message.result
          : message.errors.join("\n") || message.subtype,
        source.rateLimit,
      );
    }
    return message;
  }
}

/**
 * Waits for Claude Code to take a frame of history that asked for no turn,
 * which it acknowledges with a result of no turns.
 */
export async function historyFrameTaken(source: MessageSource) {
  while (true) {
    const message = await nextMessage(source);
    // An older build takes the frames out of order, which would hand the
    // model a scrambled conversation; failing the step says why instead.
    if (
      message.type === "system" &&
      message.subtype === "init" &&
      !runsClaudeCode(message.claude_code_version)
    ) {
      throw new Error(
        `Claude Code ${message.claude_code_version} is older than ${OLDEST_CLAUDE_CODE}, the oldest that takes a replayed conversation in order.`,
      );
    }
    if (message.type !== "result") {
      continue;
    }
    if (message.num_turns !== 0) {
      throw new Error("Claude Code ran a turn on a frame of history.");
    }
    return;
  }
}

/**
 * Reads the CLI's output while it takes the tool results it waited on and
 * ends its turn there without a reply, as a session ending its turn after
 * tools has it do. A reply would answer the results without the message
 * meant to come with them, so the step fails instead, and the session it
 * closes starts over next time.
 */
export async function endTurnOnResults(source: MessageSource) {
  while (true) {
    const message = await nextMessage(source);
    if (message.type === "assistant" || message.type === "stream_event") {
      throw new Error(
        "Claude Code went on to the model with the tool results before the message that came after them.",
      );
    }
    if (message.type === "result") {
      return;
    }
  }
}

/** The text of an assistant message Claude Code reports a failure with. */
export function assistantErrorText(message: {
  message: { content: unknown[] };
}) {
  return message.message.content
    .flatMap((block) =>
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

/**
 * A failure in the shape our error classification reads: a status and an
 * Anthropic `error.type`, plus our own code for a spent plan allowance, which
 * waiting a moment does not fix.
 */
export function planError(
  kind: SDKAssistantMessageError | "unknown",
  message: string,
  rateLimit?: SDKRateLimitInfo,
) {
  const [statusCode, type, isRetryable] = ((): [number, string, boolean] => {
    switch (kind) {
      case "authentication_failed":
      case "oauth_org_not_allowed":
      case "account_on_hold":
      case "verification_required":
      case "billing_error":
      case "cloud_credential_error": {
        return [401, "authentication_error", false];
      }
      case "rate_limit": {
        return rateLimit?.status === "rejected"
          ? [429, "claude_account_usage_limit_exceeded", false]
          : [429, "rate_limit_error", true];
      }
      case "overloaded": {
        return [529, "overloaded_error", true];
      }
      case "server_error": {
        return [502, "api_error", true];
      }
      case "invalid_request":
      case "model_not_found": {
        return [400, "invalid_request_error", false];
      }
      default: {
        return [500, "api_error", false];
      }
    }
  })();
  return new APICallError({
    isRetryable,
    message: message || kind,
    requestBodyValues: {},
    // A spent plan carries when it comes back (seconds since the epoch), so
    // the chat can say until when.
    responseBody: JSON.stringify({
      error: {
        message,
        type,
        ...(type === "claude_account_usage_limit_exceeded" &&
          typeof rateLimit?.resetsAt === "number" && {
            resets_at: rateLimit.resetsAt,
          }),
      },
    }),
    statusCode,
    url: "claude-account://",
  });
}
