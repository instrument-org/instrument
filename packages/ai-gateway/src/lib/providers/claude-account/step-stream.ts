import {
  type LanguageModelV4FinishReason,
  type LanguageModelV4StreamPart,
  type LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { assistantErrorText, nextMessage, planError } from "./cli-messages";
import { type ClaudeCodeSession, TOOL_PREFIX } from "./session";

export const CLAUDE_ACCOUNT_PROVIDER_ID = "claude-account";

/** What one step reads from and leaves on the process it runs in. */
export type StepSession = Pick<
  ClaudeCodeSession,
  | "awaitingToolCallIds"
  | "builtInTools"
  | "contextWindow"
  | "forkPoint"
  | "leaf"
  | "messages"
  | "rateLimit"
  | "stderr"
>;

/** Read the CLI's output for one step, ending where it calls our tools or its turn ends. */
export async function pumpStep(
  session: StepSession,
  controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
) {
  const blocks = new Map<
    number,
    {
      id: string;
      input: string;
      kind: "reasoning" | "text" | "tool";
      /** A redacted thinking block's opaque data. */
      redactedData?: string;
      /** A thinking block's signature, which lets it go back to Claude. */
      signature?: string;
      started: boolean;
      toolName: string;
    }
  >();
  const toolCallIds: string[] = [];
  let messageId: string = randomUUID();
  let messageModel: string | undefined;
  let stopReason: string | null = null;
  // Counted per API message, from its start and its closing delta. One step
  // can span several (a built-in search answers its results in another).
  let stepUsage: AnthropicUsage = {};
  let messageUsage: AnthropicUsage = {};
  // Until the reply starts, each user-side entry Claude Code reports (a tool
  // result we answered, a message we sent) is the step's input so far.
  let replying = false;

  const finish = (finishReason: LanguageModelV4FinishReason) => {
    const { rateLimit } = session;
    controller.enqueue({
      finishReason,
      providerMetadata: rateLimit
        ? {
            [CLAUDE_ACCOUNT_PROVIDER_ID]: {
              // The plan's usage, for a surface that shows it later.
              rateLimit: {
                rateLimitType: rateLimit.rateLimitType ?? null,
                resetsAt: rateLimit.resetsAt ?? null,
                status: rateLimit.status,
                utilization: rateLimit.utilization ?? null,
              },
            },
          }
        : undefined,
      type: "finish",
      usage: usageOf(stepUsage),
    });
  };

  while (true) {
    const message = await nextMessage(session);
    switch (message.type) {
      case "assistant": {
        replying = true;
        // One entry per content block; a subagent's go elsewhere.
        if (message.parent_tool_use_id === null) {
          session.leaf = message.uuid;
        }
        if (message.error && message.error !== "max_output_tokens") {
          throw planError(
            message.error,
            assistantErrorText(message),
            session.rateLimit,
          );
        }
        break;
      }
      case "user": {
        if (!replying && message.uuid) {
          session.forkPoint = message.uuid;
        }
        for (const source of webSearchSources(message.tool_use_result)) {
          controller.enqueue({
            id: randomUUID(),
            sourceType: "url",
            title: source.title,
            type: "source",
            url: source.url,
          });
        }
        break;
      }
      case "result": {
        session.contextWindow = contextWindowOf(message, messageModel);
        finish(finishReasonOf(stopReason));
        return;
      }
      case "stream_event": {
        replying = true;
        // Output from a subagent the CLI ran itself, which ours never ask for.
        if (message.parent_tool_use_id !== null) {
          break;
        }
        const event = message.event;
        switch (event.type) {
          case "message_start": {
            messageId = event.message.id;
            messageModel = event.message.model;
            messageUsage = event.message.usage;
            controller.enqueue({
              id: messageId,
              modelId: event.message.model,
              type: "response-metadata",
            });
            break;
          }
          case "content_block_start": {
            const block = event.content_block;
            const id = `${messageId}-${event.index}`;
            if (block.type === "text") {
              blocks.set(event.index, {
                id,
                input: "",
                kind: "text",
                started: true,
                toolName: "",
              });
              controller.enqueue({ id, type: "text-start" });
            } else if (block.type === "thinking") {
              // Opened at its first text: the CLI streams a thinking block
              // whose text it leaves out, which would be an empty part.
              blocks.set(event.index, {
                id,
                input: "",
                kind: "reasoning",
                started: false,
                toolName: "",
              });
            } else if (block.type === "redacted_thinking") {
              blocks.set(event.index, {
                id,
                input: "",
                kind: "reasoning",
                redactedData: block.data,
                started: false,
                toolName: "",
              });
            } else if (
              block.type === "tool_use" &&
              session.builtInTools.has(block.name)
            ) {
              // Claude Code runs this one itself and carries on; the step
              // goes on past it, and its results arrive as sources.
              break;
            } else if (block.type === "tool_use") {
              // Our prompts name a tool as we do (`bash`), and the CLI lists it
              // under its MCP prefix, so a call can come either way; the
              // session aliases the bare name to the same tool. A name that is
              // neither goes to our loop as called, which answers it as an
              // unknown tool.
              const toolName = block.name.startsWith(TOOL_PREFIX)
                ? block.name.slice(TOOL_PREFIX.length)
                : block.name;
              blocks.set(event.index, {
                id: block.id,
                input: "",
                kind: "tool",
                started: true,
                toolName,
              });
              controller.enqueue({
                id: block.id,
                toolName,
                type: "tool-input-start",
              });
            }
            break;
          }
          case "content_block_delta": {
            const block = blocks.get(event.index);
            if (!block) {
              break;
            }
            const delta = event.delta;
            if (delta.type === "text_delta") {
              controller.enqueue({
                delta: delta.text,
                id: block.id,
                type: "text-delta",
              });
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              if (!block.started) {
                block.started = true;
                controller.enqueue({ id: block.id, type: "reasoning-start" });
              }
              controller.enqueue({
                delta: delta.thinking,
                id: block.id,
                type: "reasoning-delta",
              });
            } else if (delta.type === "signature_delta") {
              block.signature = (block.signature ?? "") + delta.signature;
            } else if (delta.type === "input_json_delta") {
              block.input += delta.partial_json;
              controller.enqueue({
                delta: delta.partial_json,
                id: block.id,
                type: "tool-input-delta",
              });
            }
            break;
          }
          case "content_block_stop": {
            const block = blocks.get(event.index);
            if (!block) {
              break;
            }
            blocks.delete(event.index);
            if (block.kind === "text") {
              controller.enqueue({ id: block.id, type: "text-end" });
            } else if (block.kind === "reasoning") {
              // Kept with the part, so a replay can hand Claude its own
              // reasoning back: a signed block from this model, or a
              // redacted one.
              const signed =
                block.signature !== undefined ||
                block.redactedData !== undefined;
              if (!block.started && signed) {
                controller.enqueue({ id: block.id, type: "reasoning-start" });
              }
              if (block.started || signed) {
                controller.enqueue({
                  id: block.id,
                  providerMetadata: signed
                    ? {
                        [CLAUDE_ACCOUNT_PROVIDER_ID]: {
                          ...(messageModel && { model: messageModel }),
                          ...(block.redactedData !== undefined && {
                            redactedData: block.redactedData,
                          }),
                          ...(block.signature !== undefined && {
                            signature: block.signature,
                          }),
                        },
                      }
                    : undefined,
                  type: "reasoning-end",
                });
              }
            } else {
              controller.enqueue({ id: block.id, type: "tool-input-end" });
              controller.enqueue({
                input: block.input || "{}",
                toolCallId: block.id,
                toolName: block.toolName,
                type: "tool-call",
              });
              toolCallIds.push(block.id);
            }
            break;
          }
          case "message_delta": {
            stopReason = event.delta.stop_reason;
            messageUsage = mergeUsage(messageUsage, event.usage);
            break;
          }
          case "message_stop": {
            stepUsage = addMessageUsage(stepUsage, messageUsage);
            messageUsage = {};
            if (stopReason === "tool_use" && toolCallIds.length > 0) {
              session.awaitingToolCallIds = toolCallIds;
              finish({ raw: stopReason, unified: "tool-calls" });
              return;
            }
            break;
          }
        }
        break;
      }
      default: {
        break;
      }
    }
  }
}

function finishReasonOf(
  stopReason: string | null,
): LanguageModelV4FinishReason {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence": {
      return { raw: stopReason, unified: "stop" };
    }
    case "max_tokens": {
      return { raw: stopReason, unified: "length" };
    }
    case "refusal": {
      return { raw: stopReason, unified: "content-filter" };
    }
    default: {
      return { raw: stopReason ?? undefined, unified: "other" };
    }
  }
}

interface AnthropicUsage {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

const USAGE_FIELDS = [
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "input_tokens",
  "output_tokens",
] as const;

/** A message's usage as its closing delta reports it, keeping what the delta leaves out. */
function mergeUsage(
  start: AnthropicUsage,
  delta: AnthropicUsage,
): AnthropicUsage {
  const merged = { ...start };
  for (const field of USAGE_FIELDS) {
    merged[field] = delta[field] ?? start[field];
  }
  return merged;
}

/**
 * A step's usage once another of its API messages has finished. Each message
 * sends the whole conversation so far, so the step's input is the last one's,
 * which already holds every earlier one's: summing them would count the
 * history once per message. Output is new in each, so it adds up.
 */
function addMessageUsage(
  step: AnthropicUsage,
  message: AnthropicUsage,
): AnthropicUsage {
  return {
    cache_creation_input_tokens: message.cache_creation_input_tokens,
    cache_read_input_tokens: message.cache_read_input_tokens,
    input_tokens: message.input_tokens,
    output_tokens: (step.output_tokens ?? 0) + (message.output_tokens ?? 0),
  };
}

/**
 * The context window Claude Code ran the step's model in, from the per-model
 * totals its turn's result carries, keyed by the model each served. Absent
 * from a result that names no such model, as a turn that failed before the
 * model answered.
 */
function contextWindowOf(
  result: Extract<SDKMessage, { type: "result" }>,
  model: string | undefined,
) {
  if (model === undefined) {
    return undefined;
  }
  // Typed as always there, but a recorded result or an older CLI's has none.
  const totals: Partial<typeof result.modelUsage> = result.modelUsage ?? {};
  const usage =
    totals[model] ??
    Object.values(totals).find((entry) => entry?.canonicalModel === model);
  return usage !== undefined && usage.contextWindow > 0
    ? usage.contextWindow
    : undefined;
}

function usageOf(usage: AnthropicUsage): LanguageModelV4Usage {
  const noCache = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: {
      cacheRead,
      cacheWrite,
      noCache,
      total: noCache + cacheRead + cacheWrite,
    },
    outputTokens: {
      reasoning: undefined,
      text: undefined,
      total: usage.output_tokens ?? undefined,
    },
  };
}

export function emptyUsage(): LanguageModelV4Usage {
  return usageOf({});
}

/** What a WebSearch run by Claude Code reports, as its tool result. */
const WebSearchOutputSchema = z.object({
  results: z.array(
    z.union([
      z.object({
        content: z.array(z.object({ title: z.string(), url: z.string() })),
      }),
      z.string(),
    ]),
  ),
});

/** The pages a WebSearch Claude Code ran turned up, or none for any other result. */
function webSearchSources(result: unknown) {
  const parsed = WebSearchOutputSchema.safeParse(result);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.results.flatMap((entry) =>
    typeof entry === "string" ? [] : entry.content,
  );
}
