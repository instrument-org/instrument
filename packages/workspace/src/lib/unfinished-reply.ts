import {
  EMPTY_RESPONSE_CODE,
  EMPTY_RESPONSE_MESSAGE,
  STREAM_ENDED_EARLY_CODE,
  STREAM_ENDED_EARLY_MESSAGE,
} from "@instrument-org/shared";
import type {
  FinishReason,
  LanguageModelUsage,
  TextStreamPart,
  ToolSet,
} from "ai";

/** Stream parts that are part of the reply itself, as against its framing. */
export const REPLY_CONTENT_PART_TYPES: ReadonlySet<
  TextStreamPart<ToolSet>["type"]
> = new Set([
  "file",
  "reasoning-delta",
  "reasoning-start",
  "source",
  "text-delta",
  "text-start",
  "tool-call",
  "tool-input-start",
  "tool-result",
]);

/**
 * A reply that finished without being one, carrying a code the way a
 * provider's streamed error does, so it is classified and retried like one.
 */
export class UnfinishedReplyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UnfinishedReplyError";
  }
}

/**
 * Why a reply that finished was not one, or undefined for one that was.
 *
 * Two shapes:
 *
 * - A normal stop with nothing in it: no text, no reasoning, no tool call. A
 *   reply that only reasoned is still a reply.
 * - A finish with no reason and no usage, which is what the SDK reports for a
 *   chat-completions stream that closed before its last chunk: it starts the
 *   reason at `other` and keeps it when none arrives. A provider's own `other`
 *   comes with the usage chunk, so it is left alone.
 */
export function unfinishedReply({
  finishReason,
  repliedWithContent,
  usage,
}: {
  finishReason: FinishReason;
  repliedWithContent: boolean;
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">;
}): UnfinishedReplyError | undefined {
  if (finishReason === "stop" && !repliedWithContent) {
    return new UnfinishedReplyError(
      EMPTY_RESPONSE_CODE,
      EMPTY_RESPONSE_MESSAGE,
    );
  }
  if (
    finishReason === "other" &&
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined
  ) {
    return new UnfinishedReplyError(
      STREAM_ENDED_EARLY_CODE,
      STREAM_ENDED_EARLY_MESSAGE,
    );
  }
  return undefined;
}
