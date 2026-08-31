import type { ToolSet } from "ai";
import type { ActorRef, AnyMachineSnapshot } from "xstate";

import {
  type AIGatewayModel,
  CLIENT_SESSION_ID_HEADER,
  fetchAISDKModel,
  findCachedModelByProviderId,
  namesSameModel,
  providerOptionsForModel,
} from "@instrument-org/ai-gateway";
import {
  APICallError,
  InvalidToolInputError,
  LoadAPIKeyError,
  NoSuchToolError,
  parsePartialJson,
  streamText,
} from "ai";
import { fromPromise } from "xstate";

import { type AnyAgent } from "../agents/types";
import { classifyProviderError } from "../lib/classify-provider-error";
import { getCurrentDate } from "../lib/get-current-date";
import { isToolPart } from "../lib/is-tool-part";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../lib/llm-token-limits";
import { prepareModelMessages } from "../lib/prepare-model-messages";
import { Store } from "../lib/store";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { getWorkspaceServerURL } from "../logic/server/url";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { ToolNameSchema } from "../tools/name";

// A streaming save writes the part's entire accumulated text through a full
// schema parse, serialization, and synchronous SQLite write, and publishes a
// part.updated event, so saving on every delta makes per-turn store work
// quadratic in part size. Delta saves are coalesced instead: a part is only
// written when this much time has passed or this much text has accumulated
// since its last save, whichever comes first.
const DELTA_SAVE_INTERVAL_MS = 100;
const DELTA_SAVE_MAX_UNSAVED_CHARS = 4096;

interface LLMRequestInput {
  agent: AnyAgent;
  model: AIGatewayModel.Type;
  self: ActorRef<AnyMachineSnapshot, { type: "llmRequest.chunkReceived" }>;
  sessionId: StoreId.Session;
  stepCount: number;
  taskId: TaskId;
  toolChoice?: "auto" | "none" | "required";
}

export const llmRequestLogic = fromPromise<
  {
    message: SessionMessage.Assistant;
    parts: SessionMessagePart.Type[];
  },
  LLMRequestInput
>(async ({ input, signal }) => {
  const scopedStore = {
    saveMessage: (message: Parameters<typeof Store.saveMessage>[0]) =>
      Store.saveMessage(message, input.taskId, { signal }).then((result) => {
        if (result.isErr()) {
          getWorkspaceConfig().captureException(result.error, {
            scopes: ["workspace", "llm-request"],
          });
          return;
        }
        return result.value;
      }),
    savePart: (part: Parameters<typeof Store.savePart>[0]) =>
      Store.savePart(part, input.taskId, { signal }).then((result) => {
        if (result.isErr()) {
          getWorkspaceConfig().captureException(result.error, {
            scopes: ["workspace", "llm-request"],
          });
          return;
        }
        return result.value;
      }),
  };

  // Bookkeeping for coalesced delta saves, keyed by part id. `save` persists
  // the part's current accumulated state and is refreshed on every delta, so
  // a flush always writes the latest text. An entry with unsaved characters
  // means the store is behind the in-memory part. The clock is
  // performance.now rather than getCurrentDate because the cadence should
  // follow real elapsed time, not the mockable timestamp source.
  const pendingDeltaSaves = new Map<
    string,
    {
      lastSavedAtMs?: number;
      save: () => PromiseLike<unknown>;
      unsavedChars: number;
    }
  >();

  // Saves a part that accumulates streamed deltas, writing through on the
  // part's first delta and after that only when DELTA_SAVE_INTERVAL_MS or
  // DELTA_SAVE_MAX_UNSAVED_CHARS has built up since its last save. The
  // part-end handlers save the complete part unconditionally and drop the
  // entry; the flush in getCurrentParts covers parts that never get an end
  // event before parts are read back.
  const savePartCoalesced = async (
    partId: string,
    deltaLength: number,
    save: () => PromiseLike<unknown>,
  ) => {
    let entry = pendingDeltaSaves.get(partId);
    if (!entry) {
      entry = { save, unsavedChars: 0 };
      pendingDeltaSaves.set(partId, entry);
    }
    entry.save = save;
    entry.unsavedChars += deltaLength;
    const nowMs = performance.now();
    if (
      entry.lastSavedAtMs !== undefined &&
      nowMs - entry.lastSavedAtMs < DELTA_SAVE_INTERVAL_MS &&
      entry.unsavedChars < DELTA_SAVE_MAX_UNSAVED_CHARS
    ) {
      return;
    }
    entry.lastSavedAtMs = nowMs;
    entry.unsavedChars = 0;
    await save();
  };

  const captureEvent = getWorkspaceConfig().captureEvent;
  const providerId = input.model.params.provider;
  const modelId = input.model.canonicalId;
  const assistantMessage: SessionMessage.Assistant = {
    id: StoreId.newMessageId(),
    metadata: {
      aiGatewayModel: input.model,
      createdAt: getCurrentDate(),
      finishReason: "unknown",
      modelId,
      providerId,
      sessionId: input.sessionId,
    },
    role: "assistant",
  };

  // Stamped when the request goes out, so a turn that ends by abort or error
  // can still report the time it spent generating. Absent until then: a turn
  // stopped before its request left spent none.
  let requestStartedAtMs: number | undefined;

  function msSinceRequestStart() {
    return requestStartedAtMs === undefined
      ? undefined
      : getCurrentDate().getTime() - requestStartedAtMs;
  }

  function saveAbortMessage() {
    assistantMessage.metadata.error = {
      kind: "aborted",
      message: "Aborted",
    };
    assistantMessage.metadata.finishedAt = getCurrentDate();
    assistantMessage.metadata.finishReason = "aborted";
    assistantMessage.metadata.msToFinish ??= msSinceRequestStart();
    void scopedStore.saveMessage(assistantMessage);
  }

  async function getCurrentParts() {
    // Delta saves are coalesced, so an in-memory part can hold text the store
    // has not seen; write those tails through before reading parts back, or
    // they would be missing from the returned parts.
    for (const entry of pendingDeltaSaves.values()) {
      if (entry.unsavedChars > 0) {
        await entry.save();
      }
    }
    pendingDeltaSaves.clear();
    const partsResult = await Store.getParts(
      input.sessionId,
      assistantMessage.id,
      input.taskId,
      { signal },
    );
    if (partsResult.isErr()) {
      getWorkspaceConfig().captureException(partsResult.error, {
        scopes: ["workspace", "llm-request"],
      });
    }
    return partsResult.isOk() ? partsResult.value : [];
  }

  const agentTools = await input.agent.getTools();

  const tools: ToolSet = {};
  for (const tool of agentTools) {
    tools[tool.name as string] = await tool.aiSDKTool({
      agentName: input.agent.name,
      model: input.model,
      taskId: input.taskId,
    });
  }

  const messagesResult = await prepareModelMessages({
    agent: input.agent,
    model: input.model,
    sessionId: input.sessionId,
    signal,
    taskId: input.taskId,
  });

  if (messagesResult.isErr()) {
    throw new Error(
      `Error preparing model messages: ${JSON.stringify(messagesResult.error)}`,
    );
  }

  if (signal.aborted) {
    saveAbortMessage();
    return { message: assistantMessage, parts: await getCurrentParts() };
  }

  await scopedStore.saveMessage(assistantMessage);

  const abortListener = () => {
    saveAbortMessage();
  };
  const isSignalAborted = () => signal.aborted;

  signal.addEventListener("abort", abortListener);

  let currentTextPart: SessionMessagePart.TextPart | undefined;
  const reasoningMap: Record<string, SessionMessagePart.ReasoningPart> = {};
  let msToFirstChunk: number | undefined;
  let msToFinish: number | undefined;

  // A provider that closes a reasoning block when text starts can still leave
  // it open on a turn that goes straight from reasoning to a tool call, and
  // only end it when the whole step finishes. That leaves the part streaming
  // for the rest of the step and measures its duration against the step rather
  // than the thinking. The first part that supersedes it is where it actually
  // ended, so close it there.
  const endSupersededReasoning = async () => {
    for (const [id, reasoningPart] of Object.entries(reasoningMap)) {
      if (reasoningPart.state !== "streaming") {
        continue;
      }
      const updatedPart: SessionMessagePart.ReasoningPart = {
        ...reasoningPart,
        metadata: {
          ...reasoningPart.metadata,
          endedAt: getCurrentDate(),
        },
        state: "done",
        text: reasoningPart.text.trimEnd(),
      };
      reasoningMap[id] = updatedPart;
      await scopedStore.savePart(updatedPart);
      pendingDeltaSaves.delete(updatedPart.metadata.id);
    }
  };

  if (isSignalAborted()) {
    saveAbortMessage();
    return { message: assistantMessage, parts: await getCurrentParts() };
  }

  const toolCalls: Record<string, SessionMessagePart.ToolPart> = {};
  const toolCallInputText: Record<string, string> = {};
  try {
    // Fetch AI SDK model at the last moment before making the LLM request
    const workspaceConfig = getWorkspaceConfig();
    const aiSDKModelResult = await fetchAISDKModel({
      captureException: workspaceConfig.captureException,
      configs: workspaceConfig.getAIProviderConfigs(),
      modelCache: workspaceConfig.modelCache,
      modelURI: input.model.uri,
      workspaceServerURL: getWorkspaceServerURL(),
    });

    if (!aiSDKModelResult.ok) {
      throw new Error(
        `Failed to fetch AI SDK model: ${aiSDKModelResult.error.message}`,
      );
    }

    const aiSDKModel = aiSDKModelResult.value;

    requestStartedAtMs = getCurrentDate().getTime();
    const result = streamText({
      abortSignal: signal,
      // Groups this session's generations into one trace in the analytics our
      // gateway reports.
      headers: { [CLIENT_SESSION_ID_HEADER]: input.sessionId },
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      maxRetries: 0, // Handled outside this function
      messages: messagesResult.value,
      model: aiSDKModel,
      onError: () => {
        // These are thrown and handled by the catch block
        // no-op to avoid excessive logging
      },
      providerOptions: providerOptionsForModel(aiSDKModel),
      toolChoice: input.toolChoice,
      tools,
    });

    for await (const part of result.fullStream) {
      if (isSignalAborted() || part.type === "abort") {
        // Ensures we don't try to process any more parts
        break;
      }
      input.self.send({ type: "llmRequest.chunkReceived" });
      if (
        part.type === "text-start" ||
        part.type === "tool-call" ||
        part.type === "tool-input-start"
      ) {
        await endSupersededReasoning();
      }
      switch (part.type) {
        case "error": {
          // This blows up the whole stream for any error, but it does not have
          // to. E.g. an invalid tool call could still contain other valid tool
          // calls.
          throw part.error;
        }
        case "finish": {
          msToFinish = msSinceRequestStart();
          const completionTokensPerSecond =
            part.totalUsage.outputTokens && msToFinish
              ? (part.totalUsage.outputTokens / msToFinish) * 1000
              : undefined;
          assistantMessage.metadata.usage = part.totalUsage;
          assistantMessage.metadata.finishedAt = getCurrentDate();
          assistantMessage.metadata.finishReason = part.finishReason;
          assistantMessage.metadata.msToFinish = msToFinish;
          assistantMessage.metadata.msToFirstChunk = msToFirstChunk;
          assistantMessage.metadata.completionTokensPerSecond =
            completionTokensPerSecond;
          await scopedStore.saveMessage(assistantMessage);
          captureEvent("llm.request_finished", {
            cached_input_tokens:
              part.totalUsage.inputTokenDetails.cacheReadTokens ?? 0,
            completion_tokens_per_second: completionTokensPerSecond,
            finish_reason: part.finishReason,
            input_tokens: part.totalUsage.inputTokens ?? 0,
            model_id_served: assistantMessage.metadata.modelIdServed,
            modelId,
            ms_to_finish: msToFinish ?? 0,
            ms_to_first_chunk: msToFirstChunk ?? 0,
            output_tokens: part.totalUsage.outputTokens ?? 0,
            providerId,
            reasoning_tokens:
              part.totalUsage.outputTokenDetails.reasoningTokens ?? 0,
            step_count: input.stepCount,
            total_tokens: part.totalUsage.totalTokens ?? 0,
          });
          break;
        }
        case "file": {
          // Not supported yet
          break;
        }
        case "finish-step": {
          // We only run one step, so the rest of this is covered by "finish",
          // which has no response metadata of its own to read the served model
          // from.
          //
          // Compared against the id we handed the SDK rather than stored
          // outright, because the SDK seeds this field with that same id and
          // only overwrites it if the provider reports one. An id equal to what
          // we sent therefore says nothing: it is either a provider confirming
          // our request or a provider that never mentioned the subject, and
          // Google is always the second. A difference is the only thing that
          // can only have come from the provider.
          //
          // A dated build of the model we asked for is not a difference worth
          // recording, which is what keeps a provider that resolves its own
          // aliases from reporting a substitution on every turn.
          if (!namesSameModel(aiSDKModel.modelId, part.response.modelId)) {
            assistantMessage.metadata.modelIdServed = part.response.modelId;
            assistantMessage.metadata.aiGatewayModelServed =
              findCachedModelByProviderId({
                configs: workspaceConfig.getAIProviderConfigs(),
                modelCache: workspaceConfig.modelCache,
                providerConfigId: input.model.params.providerConfigId,
                providerId: part.response.modelId,
              });
          }
          break;
        }
        case "raw": {
          throw new Error(`Unexpected raw part: ${JSON.stringify(part)}`);
        }
        case "reasoning-delta": {
          const reasoningPart = reasoningMap[part.id];
          if (reasoningPart) {
            reasoningPart.text += part.text;
            if (part.providerMetadata !== undefined) {
              reasoningPart.providerMetadata = part.providerMetadata;
            }
            // A block that keeps producing text after a later part closed it
            // was not superseded after all, so it reopens and is measured to
            // wherever it ends up ending.
            reasoningPart.state = "streaming";
            reasoningPart.metadata.endedAt = undefined;
            if (reasoningPart.text) {
              await savePartCoalesced(
                reasoningPart.metadata.id,
                part.text.length,
                () => scopedStore.savePart(reasoningPart),
              );
            }
          }
          break;
        }
        case "reasoning-end": {
          const reasoningPart = reasoningMap[part.id];
          if (reasoningPart) {
            const updatedPart: SessionMessagePart.ReasoningPart = {
              ...reasoningPart,
              metadata: {
                ...reasoningPart.metadata,
                // A superseded block already recorded where it ended; this
                // event can arrive a whole step later.
                endedAt: reasoningPart.metadata.endedAt ?? getCurrentDate(),
              },
              ...(part.providerMetadata !== undefined && {
                providerMetadata: part.providerMetadata,
              }),
              state: "done",
              text: reasoningPart.text.trimEnd(),
            };
            await scopedStore.savePart(updatedPart);
            pendingDeltaSaves.delete(updatedPart.metadata.id);
            // oxlint-disable-next-line typescript/no-dynamic-delete
            delete reasoningMap[part.id];
          }
          break;
        }
        case "reasoning-start": {
          if (part.id in reasoningMap) {
            continue;
          }
          const newReasoningPart: SessionMessagePart.ReasoningPart = {
            metadata: {
              createdAt: getCurrentDate(),
              id: StoreId.newPartId(),
              messageId: assistantMessage.id,
              sessionId: input.sessionId,
            },
            ...(part.providerMetadata !== undefined && {
              providerMetadata: part.providerMetadata,
            }),
            state: "streaming",
            text: "",
            type: "reasoning",
          };
          reasoningMap[part.id] = newReasoningPart;
          await scopedStore.savePart(newReasoningPart);
          break;
        }
        case "source": {
          // eslint-disable-next-line unicorn/prefer-ternary
          if (part.sourceType === "url") {
            await scopedStore.savePart({
              metadata: {
                createdAt: getCurrentDate(),
                id: StoreId.newPartId(),
                messageId: assistantMessage.id,
                sessionId: input.sessionId,
              },
              sourceId: part.id,
              title: part.title,
              type: "source-url",
              url: part.url,
            });
          } else {
            await scopedStore.savePart({
              filename: part.filename,
              mediaType: part.mediaType,
              metadata: {
                createdAt: getCurrentDate(),
                id: StoreId.newPartId(),
                messageId: assistantMessage.id,
                sessionId: input.sessionId,
              },
              sourceId: part.id,
              title: part.title,
              type: "source-document",
            });
          }
          break;
        }
        case "start": {
          await scopedStore.savePart({
            metadata: {
              createdAt: getCurrentDate(),
              id: StoreId.newPartId(),
              messageId: assistantMessage.id,
              sessionId: input.sessionId,
              stepCount: input.stepCount,
            },
            type: "step-start",
          });
          break;
        }

        case "start-step": {
          // We only run one step, so this is covered by "start"
          msToFirstChunk ??= msSinceRequestStart();
          break;
        }
        case "text-delta": {
          if (currentTextPart) {
            const textPart = currentTextPart;
            textPart.text += part.text;
            if (part.providerMetadata !== undefined) {
              textPart.providerMetadata = part.providerMetadata;
            }
            if (textPart.text) {
              await savePartCoalesced(
                textPart.metadata.id,
                part.text.length,
                () => scopedStore.savePart(textPart),
              );
            }
          }
          break;
        }
        case "text-end": {
          if (currentTextPart && currentTextPart.text.length > 0) {
            const updatedPart: SessionMessagePart.TextPart = {
              ...currentTextPart,
              metadata: {
                ...currentTextPart.metadata,
                endedAt: getCurrentDate(),
              },
              ...(part.providerMetadata !== undefined && {
                providerMetadata: part.providerMetadata,
              }),
              state: "done",
              text: currentTextPart.text.trimEnd(),
            };
            await scopedStore.savePart(updatedPart);
            pendingDeltaSaves.delete(updatedPart.metadata.id);
          }
          currentTextPart = undefined;
          break;
        }
        case "text-start": {
          currentTextPart = {
            metadata: {
              createdAt: getCurrentDate(),
              id: StoreId.newPartId(),
              messageId: assistantMessage.id,
              sessionId: input.sessionId,
            },
            ...(part.providerMetadata !== undefined && {
              providerMetadata: part.providerMetadata,
            }),
            state: "streaming",
            text: "",
            type: "text",
          };
          break;
        }
        case "tool-call": {
          const existingPart = toolCalls[part.toolCallId];
          if (existingPart?.state === "input-streaming") {
            const updatedPart: SessionMessagePart.ToolPart = {
              ...existingPart,
              ...(part.providerMetadata !== undefined && {
                callProviderMetadata: part.providerMetadata,
              }),
              // oxlint-disable-next-line typescript/no-unsafe-assignment -- the AI SDK types a streaming tool-call `input` as `any`
              input: part.input,
              providerExecuted: part.providerExecuted,
              state: "input-available",
            };
            await scopedStore.savePart(updatedPart);
          } else if (existingPart) {
            // Unexpected state, but don't throw - just log
            getWorkspaceConfig().captureException(
              new Error("Unexpected tool call state"),
              {
                existing_part_state: existingPart.state,
                scopes: ["workspace", "llm-request"],
                tool_name: part.toolName,
              },
            );
          } else {
            // Part never created - create it now to continue functioning
            // ai-sdk-ollama@3.3.0 is the only provider that seems to do this
            const toolNameResult = ToolNameSchema.safeParse(part.toolName);
            const newPart: SessionMessagePart.ToolPart = {
              ...(part.providerMetadata !== undefined && {
                callProviderMetadata: part.providerMetadata,
              }),
              // oxlint-disable-next-line typescript/no-unsafe-assignment -- the AI SDK types a streaming tool-call `input` as `any`
              input: part.input,
              metadata: {
                createdAt: getCurrentDate(),
                id: StoreId.newPartId(),
                messageId: assistantMessage.id,
                sessionId: input.sessionId,
              },
              providerExecuted: part.providerExecuted,
              state: "input-available",
              toolCallId: StoreId.ToolCallSchema.parse(part.toolCallId),
              type: toolNameResult.success
                ? `tool-${toolNameResult.data}`
                : "tool-unavailable",
            };
            toolCalls[part.toolCallId] = newPart;
            await scopedStore.savePart(newPart);
          }
          captureEvent("llm.tool_called", {
            modelId,
            providerId,
            tool_name: part.toolName,
          });
          break;
        }
        case "tool-error": {
          // Still happens even without execute if parameters are invalid
          const toolCall = toolCalls[part.toolCallId];
          const errorText =
            typeof part.error === "string"
              ? part.error
              : JSON.stringify(part.error);
          const providerMetadataProps =
            part.providerMetadata === undefined
              ? {}
              : { callProviderMetadata: part.providerMetadata };

          if (toolCall) {
            if (
              toolCall.state === "input-available" ||
              toolCall.state === "input-streaming"
            ) {
              const updatedPart: SessionMessagePart.ToolPart = {
                ...toolCall,
                errorText,
                // oxlint-disable-next-line typescript/no-unsafe-assignment -- the AI SDK types a stored tool-call `input` as `any`
                input:
                  toolCall.state === "input-streaming"
                    ? undefined
                    : toolCall.input,
                metadata: {
                  ...toolCall.metadata,
                  endedAt: getCurrentDate(),
                },
                ...providerMetadataProps,
                providerExecuted: part.providerExecuted,
                rawInput: part.input as never,
                state: "output-error",
              };
              await scopedStore.savePart(updatedPart);
              continue;
            } else {
              // Unexpected state, capture exception
              getWorkspaceConfig().captureException(
                new Error("Unexpected tool error state"),
                {
                  scopes: ["workspace", "llm-request"],
                  tool_name: part.toolName,
                },
              );
            }
          } else {
            await scopedStore.savePart({
              ...providerMetadataProps,
              errorText,
              input: part.input as never,
              metadata: {
                createdAt: getCurrentDate(),
                endedAt: getCurrentDate(),
                id: StoreId.newPartId(),
                messageId: assistantMessage.id,
                sessionId: input.sessionId,
              },
              rawInput: part.input as never,
              state: "output-error",
              toolCallId: part.toolCallId,
              type: "tool-unavailable",
            });
          }
          captureEvent("llm.error", {
            error_type: "tool-error",
            modelId,
            providerId,
            tool_name: part.toolName,
          });
          break;
        }
        case "tool-input-delta": {
          const toolCall = toolCalls[part.id];
          if (toolCall?.state === "input-streaming") {
            toolCallInputText[part.id] =
              (toolCallInputText[part.id] || "") + part.delta;
            const { value: partialArgs } = await parsePartialJson(
              toolCallInputText[part.id],
            );
            const updatedPart: SessionMessagePart.ToolPart = {
              ...toolCall,
              input: partialArgs as never,
            };
            toolCalls[part.id] = updatedPart;
            await scopedStore.savePart(updatedPart);
          }
          break;
        }
        case "tool-input-end": {
          // No deltas for now
          break;
        }
        case "tool-input-start": {
          const toolNameResult = ToolNameSchema.safeParse(part.toolName);
          const newPart: SessionMessagePart.ToolPart = {
            input: undefined,
            metadata: {
              createdAt: getCurrentDate(),
              id: StoreId.newPartId(),
              messageId: assistantMessage.id,
              sessionId: input.sessionId,
            },
            providerExecuted: part.providerExecuted,
            ...(part.providerMetadata !== undefined && {
              callProviderMetadata: part.providerMetadata,
            }),
            state: "input-streaming",
            toolCallId: StoreId.ToolCallSchema.parse(part.id),
            type: toolNameResult.success
              ? `tool-${toolNameResult.data}`
              : "tool-unavailable",
          };
          toolCalls[part.id] = newPart;
          await scopedStore.savePart(newPart);
          break;
        }
        case "tool-output-denied": {
          getWorkspaceConfig().captureException(
            new Error(`Unexpected tool output denied: ${JSON.stringify(part)}`),
          );
          break;
        }
        case "tool-result": {
          throw new Error(`Unexpected tool result: ${JSON.stringify(part)}`);
        }
        case "tool-approval-request": {
          getWorkspaceConfig().captureException(
            new Error(
              `Unexpected tool approval request: ${JSON.stringify(part)}`,
            ),
          );
          break;
        }
        default: {
          const _exhaustiveCheck: never = part;
          throw new Error(
            `Unexpected part: ${JSON.stringify(_exhaustiveCheck)}`,
          );
        }
      }
    }
  } catch (error) {
    switch (true) {
      case error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"): {
        // Not sure if we hit this, I wasn't able to reproduce it
        assistantMessage.metadata.error = {
          kind: "aborted",
          message: error.message,
        };
        captureEvent("llm.error", {
          error_type: "aborted",
          modelId,
          providerId,
        });
        break;
      }
      case LoadAPIKeyError.isInstance(error): {
        // Pretty sure this is impossible, but opencode does it
        assistantMessage.metadata.error = {
          kind: "api-key",
          message: error.message,
        };
        captureEvent("llm.error", {
          error_type: "api-key",
          modelId,
          providerId,
        });
        break;
      }
      case APICallError.isInstance(error): {
        const classification = classifyProviderError(error);
        assistantMessage.metadata.error = {
          classification: classification.kind,
          kind: "api-call",
          message: error.message,
          name: error.name,
          responseBody: error.responseBody,
          statusCode: error.statusCode,
          url: error.url,
        };
        captureEvent("llm.error", {
          error_classification: classification.kind,
          error_classification_evidence: classification.evidence,
          error_type: "api-call",
          modelId,
          providerId,
        });
        break;
      }
      // Should not be called now that tool-error above handles this
      case InvalidToolInputError.isInstance(error): {
        assistantMessage.metadata.error = {
          input: error.toolInput,
          kind: "invalid-tool-input",
          message: error.message,
        };
        captureEvent("llm.error", {
          error_type: "invalid-tool-input",
          modelId,
          providerId,
        });
        break;
      }
      // Should not be called now that tool-error above handles this
      case NoSuchToolError.isInstance(error): {
        assistantMessage.metadata.error = {
          kind: "no-such-tool",
          message: error.message,
          toolName: error.toolName,
        };
        captureEvent("llm.error", {
          error_type: "no-such-tool",
          modelId,
          providerId,
          tool_name: error.toolName,
        });
        break;
      }
      default: {
        // A provider that fails inside a 200 stream lands here rather than in
        // the `APICallError` case above, because the request itself succeeded
        // and the failure arrived as one chunk. The classifier reads that shape
        // too, so an upstream throttle is named here instead of being reported
        // as an error nobody can identify.
        const classification = classifyProviderError(error);
        assistantMessage.metadata.error = {
          classification: classification.kind,
          kind: "unknown",
          message:
            error instanceof Error ? error.message : JSON.stringify(error),
        };
        if (classification.kind === "unknown") {
          getWorkspaceConfig().captureException(error, {
            scopes: ["workspace", "llm-request"],
          });
        } else {
          captureEvent("llm.error", {
            error_classification: classification.kind,
            error_classification_evidence: classification.evidence,
            error_type: "streamed",
            modelId,
            providerId,
          });
        }
      }
    }

    const parts = await getCurrentParts();
    for (const part of parts) {
      if (isToolPart(part) && part.state === "input-streaming") {
        const inputStreamText = toolCallInputText[part.toolCallId];
        getWorkspaceConfig().captureException(
          new Error("Unhandled tool input streaming part"),
          {
            assistant_error_kind: assistantMessage.metadata.error.kind,
            input_stream_char_count: inputStreamText?.length,
            message_id: assistantMessage.id,
            modelId,
            part_has_input: part.input !== undefined,
            part_id: part.metadata.id,
            provider_executed: part.providerExecuted,
            providerId,
            scopes: ["workspace", "llm-request"],
            session_id: input.sessionId,
            tool_call_id: part.toolCallId,
            tool_type: part.type,
          },
        );
      }
    }

    assistantMessage.metadata.finishedAt = getCurrentDate();
    assistantMessage.metadata.msToFinish ??= msSinceRequestStart();
    await scopedStore.saveMessage(assistantMessage);
  }

  // Remove abort listener since we've completed
  signal.removeEventListener("abort", abortListener);

  return { message: assistantMessage, parts: await getCurrentParts() };
});
