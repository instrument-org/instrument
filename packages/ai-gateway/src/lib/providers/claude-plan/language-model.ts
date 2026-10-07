import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FinishReason,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Prompt,
  type LanguageModelV4StreamPart,
  type LanguageModelV4Usage,
} from "@ai-sdk/provider";
import {
  type EffortLevel,
  type SDKAssistantMessageError,
  type SDKRateLimitInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { createHash, randomUUID } from "node:crypto";

import { CLIENT_SESSION_ID_HEADER } from "../../../constants";
import {
  coldStartContent,
  splitSystemPrompt,
  toolResultToMCP,
  turnContent,
} from "./prompt";
import {
  ClaudePlanSession,
  type SessionShape,
  sessionShapeKey,
  TOOL_PREFIX,
} from "./session";

export const CLAUDE_PLAN_PROVIDER_ID = "claude-plan";

/**
 * The live CLI processes, keyed by our session id and the request's shape. A
 * session sends more than its agent's steps under its id (a title, a
 * summary), each with a prompt and tools of its own, and those must not take
 * over the process its steps run in.
 */
const sessions = new Map<string, ClaudePlanSession>();

/**
 * The user's Claude plan as an AI SDK model, run through the `claude` CLI they
 * installed and signed in to. Each step the model takes is one `doStream`, so
 * our agent loop, tools and transcript work as they do for any other model.
 */
export function createClaudePlanLanguageModel({
  configDir,
  executablePath,
}: {
  configDir: string | undefined;
  executablePath: string;
}) {
  return (modelId: string): LanguageModelV4 => {
    const doStream = (options: LanguageModelV4CallOptions) =>
      Promise.resolve({
        stream: streamStep({ configDir, executablePath, modelId, options }),
      });
    return {
      doGenerate: async (options) => collect(await doStream(options)),
      doStream,
      modelId,
      provider: CLAUDE_PLAN_PROVIDER_ID,
      specificationVersion: "v4",
      supportedUrls: {},
    };
  };
}

type Continuation =
  | { kind: "tool-results"; prompt: LanguageModelV4Prompt }
  | { kind: "turn"; prompt: LanguageModelV4Prompt };

/**
 * How a request follows from what the running process last saw, or nothing
 * when it does not and the process has to start over from our transcript.
 */
function continuationOf(
  session: ClaudePlanSession,
  prompt: LanguageModelV4Prompt,
): Continuation | undefined {
  const unseen = prompt.slice(session.seenCount);
  if (session.awaitingToolCallIds.length > 0) {
    const [last] = unseen;
    if (unseen.length !== 1 || last?.role !== "tool") {
      return undefined;
    }
    const answered = new Set(
      last.content.flatMap((part) =>
        part.type === "tool-result" ? [part.toolCallId] : [],
      ),
    );
    return session.awaitingToolCallIds.every((id) => answered.has(id))
      ? { kind: "tool-results", prompt }
      : undefined;
  }
  return unseen.length > 0 &&
    unseen.every(
      (message) => message.role === "user" || message.role === "system",
    )
    ? { kind: "turn", prompt }
    : undefined;
}

function streamStep({
  configDir,
  executablePath,
  modelId,
  options,
}: {
  configDir: string | undefined;
  executablePath: string;
  modelId: string;
  options: LanguageModelV4CallOptions;
}) {
  const key = options.headers?.[CLIENT_SESSION_ID_HEADER];
  const { rest, systemPrompt } = splitSystemPrompt(options.prompt);
  const shape: SessionShape = {
    configDir,
    effort: effortOf(options),
    executablePath,
    modelId,
    systemPrompt,
    tools: (options.tools ?? []).filter(
      (tool): tool is LanguageModelV4FunctionTool => tool.type === "function",
    ),
  };

  return new ReadableStream<LanguageModelV4StreamPart>({
    start: async (controller) => {
      const shapeKey = sessionShapeKey(shape);
      // A request with no tools is a one-off (a title, a summary), and so is
      // one that arrives while its session's process is mid-step. Each gets
      // a process of its own that ends with it.
      const slot =
        key === undefined || shape.tools.length === 0
          ? undefined
          : `${key}:${createHash("sha256").update(shapeKey).digest("hex")}`;
      const existing = slot === undefined ? undefined : sessions.get(slot);
      const ephemeral = slot === undefined || existing?.busy === true;
      let session = ephemeral ? undefined : existing;
      const continuation = session && continuationOf(session, options.prompt);

      try {
        if (!continuation || !session) {
          if (session) {
            // The running process saw something other than what this request
            // continues, so it starts over from a lossy replay of ours.
            console.warn(
              `[claude-plan] session ${session.key} restarted from a transcript replay`,
            );
            session.close();
          }
          const created = new ClaudePlanSession(
            slot ?? randomUUID(),
            shape,
            () => {
              if (sessions.get(created.key) === created) {
                sessions.delete(created.key);
              }
            },
          );
          session = created;
          if (!ephemeral) {
            sessions.set(created.key, created);
          }
          created.send(coldStartContent(rest));
        } else if (continuation.kind === "tool-results") {
          const last = options.prompt.at(-1);
          for (const part of last?.role === "tool" ? last.content : []) {
            if (part.type === "tool-result") {
              session.resolveToolCall(
                part.toolCallId,
                toolResultToMCP(part.output),
              );
            }
          }
        } else {
          session.send(turnContent(options.prompt.slice(session.seenCount)));
        }

        if (session.modelId !== modelId) {
          await session.setModel(modelId);
          session.modelId = modelId;
        }

        session.busy = true;
        session.awaitingToolCallIds = [];
        session.seenCount = options.prompt.length + 1;
        session.touch();

        const running = session;
        const onAbort = () => running.close();
        options.abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          controller.enqueue({ type: "stream-start", warnings: [] });
          await pumpStep(running, controller);
        } finally {
          options.abortSignal?.removeEventListener("abort", onAbort);
          running.busy = false;
        }
        if (ephemeral && running.awaitingToolCallIds.length === 0) {
          running.close();
        }
        controller.close();
      } catch (error) {
        session?.close();
        controller.enqueue({ error, type: "error" });
        controller.close();
      }
    },
  });
}

/** Read the CLI's output for one step, ending where it calls our tools or its turn ends. */
async function pumpStep(
  session: ClaudePlanSession,
  controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
) {
  const blocks = new Map<
    number,
    {
      id: string;
      input: string;
      kind: "reasoning" | "text" | "tool";
      started: boolean;
      toolName: string;
    }
  >();
  const toolCallIds: string[] = [];
  let messageId: string = randomUUID();
  let stopReason: string | null = null;
  let usage = emptyUsage();
  let rateLimit = session.rateLimit;

  const finish = (finishReason: LanguageModelV4FinishReason) => {
    controller.enqueue({
      finishReason,
      providerMetadata: rateLimit
        ? {
            [CLAUDE_PLAN_PROVIDER_ID]: {
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
      usage,
    });
  };

  while (true) {
    const next = await session.messages.next();
    if (next.done) {
      throw planError("unknown", `Claude Code exited.\n${session.stderr}`);
    }
    const message = next.value;
    switch (message.type) {
      case "assistant": {
        if (message.error && message.error !== "max_output_tokens") {
          throw planError(
            message.error,
            assistantErrorText(message),
            rateLimit,
          );
        }
        break;
      }
      case "rate_limit_event": {
        rateLimit = message.rate_limit_info;
        session.rateLimit = rateLimit;
        break;
      }
      case "result": {
        if (message.subtype !== "success" || message.is_error) {
          throw planError(
            "unknown",
            message.subtype === "success"
              ? message.result
              : message.errors.join("\n") || message.subtype,
            rateLimit,
          );
        }
        finish(finishReasonOf(stopReason));
        return;
      }
      case "stream_event": {
        // Output from a subagent the CLI ran itself, which ours never ask for.
        if (message.parent_tool_use_id !== null) {
          break;
        }
        const event = message.event;
        switch (event.type) {
          case "message_start": {
            messageId = event.message.id;
            usage = usageOf(event.message.usage);
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
              if (block.started) {
                controller.enqueue({ id: block.id, type: "reasoning-end" });
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
            usage = usageOf(event.usage);
            break;
          }
          case "message_stop": {
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

function usageOf(usage: {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}): LanguageModelV4Usage {
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

function emptyUsage(): LanguageModelV4Usage {
  return usageOf({});
}

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

function effortOf(options: LanguageModelV4CallOptions) {
  const asked = options.providerOptions?.[CLAUDE_PLAN_PROVIDER_ID]?.effort;
  return EFFORTS.find((effort) => effort === asked);
}

function assistantErrorText(message: { message: { content: unknown[] } }) {
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
function planError(
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
          ? [429, "claude_plan_usage_limit_exceeded", false]
          : [429, "rate_limit_error", true];
      }
      case "overloaded": {
        return [529, "overloaded_error", true];
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
    responseBody: JSON.stringify({ error: { message, type } }),
    statusCode,
    url: "claude-plan://",
  });
}

/** One whole step from `doStream`, for callers that do not stream. */
async function collect({
  stream,
}: {
  stream: ReadableStream<LanguageModelV4StreamPart>;
}) {
  const content: LanguageModelV4Content[] = [];
  const texts = new Map<string, { text: string; type: "reasoning" | "text" }>();
  let finishReason: LanguageModelV4FinishReason = {
    raw: undefined,
    unified: "other",
  };
  let usage = emptyUsage();
  for await (const part of stream) {
    switch (part.type) {
      case "text-start":
      case "reasoning-start": {
        const entry = {
          text: "",
          type:
            part.type === "text-start"
              ? ("text" as const)
              : ("reasoning" as const),
        };
        texts.set(part.id, entry);
        content.push(entry);
        break;
      }
      case "text-delta":
      case "reasoning-delta": {
        const entry = texts.get(part.id);
        if (entry) {
          entry.text += part.delta;
        }
        break;
      }
      case "tool-call": {
        content.push(part);
        break;
      }
      case "finish": {
        finishReason = part.finishReason;
        usage = part.usage;
        break;
      }
      case "error": {
        throw part.error;
      }
      default: {
        break;
      }
    }
  }
  return { content, finishReason, usage, warnings: [] };
}
