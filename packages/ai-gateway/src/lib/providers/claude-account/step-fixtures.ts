import { type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { pumpStep, type StepSession } from "./language-model";

/**
 * One step as Claude Code sent it, reduced to what the stream mapping reads.
 * The model's own output stays; ids naming a session or a person's machine
 * do not.
 */
export interface RecordedStep {
  builtInTools: string[];
  messages: unknown[];
}

/**
 * What of a message the stream mapping reads, or nothing for one it never
 * looks at. Leaves out session ids, uuids, the init message (which names the
 * working folder and the account's tools), and thinking signatures.
 */
export function scrubMessage(message: SDKMessage): unknown {
  switch (message.type) {
    case "assistant": {
      return {
        error: message.error ?? null,
        message: {
          content: message.message.content.map((block) =>
            block.type === "thinking" ? { ...block, signature: "" } : block,
          ),
        },
        parent_tool_use_id: message.parent_tool_use_id,
        type: "assistant",
      };
    }
    case "user": {
      return { tool_use_result: message.tool_use_result, type: "user" };
    }
    case "rate_limit_event": {
      // The account's own usage and reset times, replaced with fixed ones.
      return {
        rate_limit_info: {
          rateLimitType: message.rate_limit_info.rateLimitType,
          resetsAt: 1_800_000_000,
          status: message.rate_limit_info.status,
          utilization: 0.5,
        },
        type: message.type,
      };
    }
    case "result": {
      return message.subtype === "success"
        ? {
            is_error: message.is_error,
            result: message.result,
            subtype: message.subtype,
            type: "result",
          }
        : {
            errors: message.errors,
            is_error: message.is_error,
            subtype: message.subtype,
            type: "result",
          };
    }
    case "stream_event": {
      const { event } = message;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "signature_delta"
      ) {
        return undefined;
      }
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "thinking"
      ) {
        return {
          event: {
            ...event,
            content_block: { ...event.content_block, signature: "" },
          },
          parent_tool_use_id: message.parent_tool_use_id,
          type: "stream_event",
        };
      }
      return {
        event,
        parent_tool_use_id: message.parent_tool_use_id,
        type: "stream_event",
      };
    }
    default: {
      return undefined;
    }
  }
}

/** Run a recorded step through the stream mapping, as a live process would. */
export async function replayStep(step: RecordedStep) {
  const queue = [...step.messages];
  const session: StepSession = {
    awaitingToolCallIds: [],
    builtInTools: new Set(step.builtInTools),
    messages: {
      next: () => {
        const value = queue.shift();
        return Promise.resolve(
          value === undefined
            ? { done: true, value: undefined }
            : // A recorded message, scrubbed to the fields the mapping reads.
              { done: false, value: value as SDKMessage },
        );
      },
    },
    rateLimit: undefined,
    stderr: "",
  };
  const parts: LanguageModelV4StreamPart[] = [];
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start: async (controller) => {
      await pumpStep(session, controller);
      controller.close();
    },
  });
  for await (const part of stream) {
    parts.push(part);
  }
  return { awaitingToolCallIds: session.awaitingToolCallIds, parts };
}
