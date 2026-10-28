import type { TextStreamPart, ToolSet } from "ai";

import {
  activityTelemetry,
  connectionFor,
  turnPurpose,
} from "../lib/activity/record";
import type { ActorRef, AnyMachineSnapshot } from "xstate";

import {
  type AIGatewayModel,
  catalogEffort,
  CLIENT_SESSION_ID_HEADER,
  fetchAISDKModel,
  findCachedModelByProviderId,
  namesSameModel,
  nativeSearchTools,
  providerOptionsForModel,
} from "@instrument-org/ai-gateway";
import { CLAUDE_ACCOUNT_PROVIDER_CONFIG } from "@instrument-org/shared";
import {
  APICallError,
  InvalidToolInputError,
  LoadAPIKeyError,
  NoSuchToolError,
  parsePartialJson,
  streamText,
} from "ai";
import { omit } from "radashi";
import { fromPromise } from "xstate";

import { type AnyAgent } from "../agents/types";
import { classifyProviderError } from "../lib/classify-provider-error";
import { describeErrorCause } from "../lib/describe-error-cause";
import { getCurrentDate } from "../lib/get-current-date";
import { isStorageFullError } from "../lib/is-storage-full-error";
import { writingChatRecords } from "../lib/records/chat-records";
import { isToolPart } from "../lib/is-tool-part";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../lib/llm-token-limits";
import { prepareModelMessages, TRANSIENT } from "../lib/prepare-model-messages";
import { summarizeBeforePriceStep } from "../lib/price-step-summary";
import { shellCommandFromToolName } from "../lib/repair-shell-command-tool-call";
import { cacheSessionFor } from "../lib/fork-cache-session";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { turnNoteFor } from "../lib/turn-note";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { getWorkspaceServerURL } from "../logic/server/url";
import { SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { TOOL_NAMES, ToolNameSchema } from "../tools/name";

// A call's input arrives as fragments of JSON, and each one is parsed over
// the whole text so far for the window to draw the call as it is typed, so
// parsing on every fragment makes the work quadratic in the input's size.
// The parse is coalesced instead: it runs on the call's first fragment and
// after that only when this much time has passed or this much text has
// arrived since the last one, whichever comes first.
const INPUT_PARSE_INTERVAL_MS = 100;
const INPUT_PARSE_MAX_UNPARSED_CHARS = 4096;

interface LLMRequestInput {
  agent: AnyAgent;
  model: AIGatewayModel.Type;
  self: ActorRef<AnyMachineSnapshot, { type: "llmRequest.chunkReceived" }>;
  sessionId: StoreId.Session;
  stepCount: number;
  /**
   * Aborts the request while its caller waits for it to return: what it was
   * holding is written on the way out, which stopping the actor would leave
   * running after the caller has moved on. Aborted with why, an
   * `AbortReason`; an abort that says nothing reads as `unknown`.
   */
  stop?: AbortSignal;
  chatId: ChatId;
}

export const llmRequestLogic = fromPromise<
  {
    message: SessionMessage.Assistant;
    parts: SessionMessagePart.Type[];
  },
  LLMRequestInput
>(async ({ input, signal: actorSignal }) => {
  const { stop } = input;
  const signal = stop ? AbortSignal.any([actorSignal, stop]) : actorSignal;
  const abortReason = () =>
    SessionMessage.AbortReasonSchema.catch("unknown").parse(
      stop?.aborted ? stop.reason : undefined,
    );
  // The first write that failed for lack of disk space. Once set, every later
  // write would fail the same way, so part saves stop, the stream loop ends
  // the request with a `disk-full` error, and the condition is reported once
  // rather than once per streaming save.
  let storageFullError: Error | undefined;

  const reportStorageError = (error: unknown) => {
    if (isStorageFullError(error)) {
      if (storageFullError !== undefined) {
        return;
      }
      storageFullError = error;
    }
    getWorkspaceConfig().captureException(error, {
      area: "llm-request",
      chatId: input.chatId,
      sessionId: input.sessionId,
    });
  };

  const writes = {
    saveMessage: (message: SessionMessage.Type) =>
      ChatWrites.saveMessage(message, input.chatId).match(
        (saved) => saved,
        (error) => {
          reportStorageError(error);
          return undefined;
        },
      ),
    savePart: async (part: SessionMessagePart.Type) => {
      if (storageFullError !== undefined) {
        return;
      }
      const saved = await ChatWrites.savePart(part, input.chatId);
      if (saved.isErr()) {
        reportStorageError(saved.error);
      }
    },
  };

  // Where a call's input stands between parses, keyed by part id, so the
  // fragments that have arrived since the last one are known. The clock is
  // performance.now rather than getCurrentDate because the cadence should
  // follow real elapsed time, not the mockable timestamp source.
  const pendingInputParses = new Map<
    string,
    { lastParsedAtMs?: number; unparsedChars: number }
  >();

  // Whether a call's input is parsed again for this fragment: on the first
  // one, and after that on the cadence above.
  const inputParseDue = (partId: string, deltaLength: number) => {
    let entry = pendingInputParses.get(partId);
    if (!entry) {
      entry = { unparsedChars: 0 };
      pendingInputParses.set(partId, entry);
    }
    entry.unparsedChars += deltaLength;
    const nowMs = performance.now();
    if (
      entry.lastParsedAtMs !== undefined &&
      nowMs - entry.lastParsedAtMs < INPUT_PARSE_INTERVAL_MS &&
      entry.unparsedChars < INPUT_PARSE_MAX_UNPARSED_CHARS
    ) {
      return false;
    }
    entry.lastParsedAtMs = nowMs;
    entry.unparsedChars = 0;
    return true;
  };

  // The reply as the window reads it while it streams, which the turn holds
  // and lets go of when it ends.
  const live = writingChatRecords()?.live(input.chatId, input.sessionId);

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
      reason: abortReason(),
    };
    assistantMessage.metadata.finishedAt = getCurrentDate();
    assistantMessage.metadata.finishReason = "aborted";
    assistantMessage.metadata.msToFinish ??= msSinceRequestStart();
    void writes.saveMessage(assistantMessage);
  }

  async function getCurrentParts() {
    const readBack = await ChatReads.transcript({
      chatId: input.chatId,
      only: new Set([assistantMessage.id]),
      sessionId: input.sessionId,
    });
    if (readBack.isErr()) {
      getWorkspaceConfig().captureException(readBack.error, {
        area: "llm-request",
        chatId: input.chatId,
        sessionId: input.sessionId,
      });
    }
    return readBack.isOk()
      ? (readBack.value.find(({ id }) => id === assistantMessage.id)?.parts ??
          [])
      : [];
  }

  const agentTools = await input.agent.getTools();

  const tools: ToolSet = {};
  for (const tool of agentTools) {
    tools[tool.name as string] = await tool.aiSDKTool({
      model: input.model,
      chatId: input.chatId,
    });
  }

  const messagesResult = await prepareModelMessages({
    agent: input.agent,
    model: input.model,
    sessionId: input.sessionId,
    signal,
    chatId: input.chatId,
    // Asked with what the turn's own request is sent with, so the summary
    // reads the request's prefix from the provider's cache.
    summarize: async (messages) => {
      const workspaceConfig = getWorkspaceConfig();
      const fetched = await fetchAISDKModel({
        captureException: workspaceConfig.captureException,
        configs: workspaceConfig.getAIProviderConfigs(),
        modelCache: workspaceConfig.modelCache,
        modelRoutes: workspaceConfig.modelRoutes,
        modelURI: input.model.uri,
        workspaceServerURL: getWorkspaceServerURL(),
      });
      if (!fetched.ok) {
        return undefined;
      }
      return summarizeBeforePriceStep({
        headers: {
          [CLIENT_SESSION_ID_HEADER]: cacheSessionFor({
            sessionId: input.sessionId,
            chatId: input.chatId,
          }),
        },
        messages,
        model: fetched.value,
        providerOptions: providerOptionsForModel(fetched.value, {
          effort: workspaceConfig.reasoningEffort ?? catalogEffort(input.model),
          reasoning: input.model.reasoning,
        }),
        signal,
        activity: activityTelemetry({
          connection: connectionFor(
            workspaceConfig.getAIProviderConfigs(),
            input.model.params.providerConfigId,
          ),
          chatId: input.chatId,
          purpose: turnPurpose(input.chatId, input.sessionId),
          sessionId: input.sessionId,
        }),
        tools,
      });
    },
  });

  if (messagesResult.isErr()) {
    throw new Error(
      `Error preparing model messages: ${JSON.stringify(messagesResult.error)}`,
    );
  }

  // Read before this step's message is stored, so the turn it describes is
  // the steps already taken. See `lib/turn-note.ts`.
  const turnNote = await turnNoteFor({
    sessionId: input.sessionId,
    chatId: input.chatId,
  });
  if (turnNote !== undefined) {
    // After the cache breakpoints, like the budget notice: for this request
    // alone, and never stored, so a model keeping its own copy of the
    // conversation must not count it as seen.
    messagesResult.value.push({
      content: turnNote,
      providerOptions: TRANSIENT,
      role: "user",
    });
  }

  if (signal.aborted) {
    saveAbortMessage();
    return { message: assistantMessage, parts: await getCurrentParts() };
  }

  await writes.saveMessage(assistantMessage);
  live?.setMessage(assistantMessage);

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
      await writes.savePart(updatedPart);
    }
  };

  if (isSignalAborted()) {
    saveAbortMessage();
    await live?.clear(assistantMessage.id);
    return { message: assistantMessage, parts: await getCurrentParts() };
  }

  const toolCalls: Record<string, SessionMessagePart.ToolPart> = {};
  // xAI names each page its hosted search read once as the search ends and
  // again as the answer cites it; the message keeps one source per page.
  const sourceURLs = new Set<string>();
  // Why each invalid tool call was rejected, read back when its `tool-error`
  // arrives: that part carries only the SDK's rendering of this error.
  const invalidToolCallErrors = new Map<string, unknown>();
  const toolCallInputText: Record<string, string> = {};

  try {
    // Fetch AI SDK model at the last moment before making the LLM request
    const workspaceConfig = getWorkspaceConfig();
    const aiSDKModelResult = await fetchAISDKModel({
      captureException: workspaceConfig.captureException,
      configs: workspaceConfig.getAIProviderConfigs(),
      modelCache: workspaceConfig.modelCache,
      modelRoutes: workspaceConfig.modelRoutes,
      modelURI: input.model.uri,
      workspaceServerURL: getWorkspaceServerURL(),
    });

    if (!aiSDKModelResult.ok) {
      throw new Error(
        `Failed to fetch AI SDK model: ${aiSDKModelResult.error.message}`,
        { cause: aiSDKModelResult.error },
      );
    }

    const aiSDKModel = aiSDKModelResult.value;

    // A Claude account searches with Claude Code's own WebSearch, inside the
    // agent's step, rather than through our web_search tool, whose search on
    // this account is a separate Claude Code process with a model of its own
    // in front of the same WebSearch. What it finds arrives as sources.
    // A Grok account does the same with xAI's hosted web and X search, which
    // run on xAI's side within the response; their calls are xAI's to run
    // and replay drops them, so only the sources they cite are kept.
    const nativeTools = await nativeSearchTools(input.model.params.provider);
    const ownToolNames =
      nativeTools && new Set(Object.keys(omit(tools, [TOOL_NAMES.webSearch])));
    const nativeCallIds = new Set<string>();
    const searchesNatively =
      aiSDKModel.provider === CLAUDE_ACCOUNT_PROVIDER_CONFIG.type ||
      nativeTools !== undefined;
    const cacheSession = cacheSessionFor({
      sessionId: input.sessionId,
      chatId: input.chatId,
    });
    const providerOptions = providerOptionsForModel(aiSDKModel, {
      effort: workspaceConfig.reasoningEffort ?? catalogEffort(input.model),
      reasoning: input.model.reasoning,
    });
    if (searchesNatively) {
      providerOptions[CLAUDE_ACCOUNT_PROVIDER_CONFIG.type] = {
        ...providerOptions[CLAUDE_ACCOUNT_PROVIDER_CONFIG.type],
        builtInTools: ["WebSearch"],
        // Its own session even for a task, so a task and its chat each keep
        // a Claude Code session of their own, a task's forked from its
        // chat's where it branched off.
        sessionId: input.sessionId,
        ...(cacheSession !== input.sessionId && {
          parentSessionId: cacheSession,
        }),
      };
    }

    requestStartedAtMs = getCurrentDate().getTime();
    const result = streamText({
      abortSignal: signal,
      // Persisted system context rides in the message list, not only at the top.
      allowSystemInMessages: true,
      // A shell command called as though it were a tool becomes the bash call
      // the model meant. See `shellCommandFromToolName` for what that failure
      // looks like and why it is repaired here rather than prompted away.
      repairToolCall: ({ toolCall }) => {
        const command = shellCommandFromToolName({
          availableToolNames: Object.keys(tools),
          toolName: toolCall.toolName,
        });
        return Promise.resolve(
          command === undefined
            ? null
            : {
                ...toolCall,
                input: JSON.stringify({ command }),
                toolName: TOOL_NAMES.bash,
              },
        );
      },
      // Groups this session's generations into one trace in the analytics our
      // gateway reports, and routes the request to the provider cache the
      // session's earlier requests warmed. A task names its chat's session,
      // whose cache holds the conversation it carries on from.
      headers: {
        [CLIENT_SESSION_ID_HEADER]: cacheSession,
      },
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      maxRetries: 0, // Handled outside this function
      messages: messagesResult.value,
      model: aiSDKModel,
      onError: () => {
        // These are thrown and handled by the catch block
        // no-op to avoid excessive logging
      },
      providerOptions,
      telemetry: activityTelemetry({
        connection: connectionFor(
          workspaceConfig.getAIProviderConfigs(),
          input.model.params.providerConfigId,
        ),
        chatId: input.chatId,
        purpose: turnPurpose(input.chatId, input.sessionId),
        sessionId: input.sessionId,
      }),
      tools: searchesNatively
        ? { ...omit(tools, [TOOL_NAMES.webSearch]), ...nativeTools }
        : tools,
    });

    for await (const part of result.stream) {
      if (isSignalAborted() || part.type === "abort") {
        // Ensures we don't try to process any more parts
        break;
      }
      if (storageFullError !== undefined) {
        throw storageFullError;
      }
      input.self.send({ type: "llmRequest.chunkReceived" });
      if (isNativeSearchPart(part, ownToolNames, nativeCallIds)) {
        continue;
      }
      if (
        part.type === "text-start" ||
        part.type === "tool-call" ||
        part.type === "tool-input-start"
      ) {
        await endSupersededReasoning();
      }
      switch (part.type) {
        case "custom": {
          // Skipped on purpose. Providers emit these only for features we do not
          // turn on (OpenAI Responses compaction, Anthropic code-execution
          // container uploads, Google Interactions processing), so there is
          // nothing to store or replay. Enabling one of those features means
          // persisting its parts, since the provider expects them back.
          break;
        }
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
          await writes.saveMessage(assistantMessage);
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
            await writes.savePart(reasoningPart);
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
            await writes.savePart(updatedPart);
            delete reasoningMap[part.id];
          }
          break;
        }
        case "reasoning-file": {
          // Skipped on purpose: an image a Gemini model drew while thinking. It
          // is a draft of the answer, not the answer, and the transcript has no
          // slot for it. Gemini documents the thought signatures it checks on
          // the answer parts that follow, and those are stored and replayed.
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
          await writes.savePart(newReasoningPart);
          break;
        }

        case "source": {
          if (part.sourceType === "url") {
            if (sourceURLs.has(part.url)) {
              break;
            }
            sourceURLs.add(part.url);
            await writes.savePart({
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
            await writes.savePart({
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
          await writes.savePart({
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
            await writes.savePart(textPart);
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
            await writes.savePart(updatedPart);
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
        case "tool-approval-response": {
          getWorkspaceConfig().captureException(
            new Error("Unexpected tool approval response"),
            {
              area: "llm-request",
              chatId: input.chatId,
              data: { part },
              sessionId: input.sessionId,
            },
          );
          break;
        }
        case "tool-call": {
          if (part.invalid) {
            invalidToolCallErrors.set(part.toolCallId, part.error);
          }
          const existingPart = toolCalls[part.toolCallId];
          if (existingPart?.state === "input-streaming") {
            // The part was typed by the name the model streamed, and
            // `repairToolCall` may have since routed the call to another
            // tool, which is the one that has to run.
            const toolNameResult = ToolNameSchema.safeParse(part.toolName);
            const updatedPart: SessionMessagePart.ToolPart = {
              ...existingPart,
              type: toolNameResult.success
                ? `tool-${toolNameResult.data}`
                : "tool-unavailable",
              ...(part.providerMetadata !== undefined && {
                callProviderMetadata: part.providerMetadata,
              }),
              // oxlint-disable-next-line typescript/no-unsafe-assignment -- the AI SDK types a streaming tool-call `input` as `any`
              input: part.input,
              providerExecuted: part.providerExecuted,
              state: "input-available",
            };
            toolCalls[part.toolCallId] = updatedPart;
            await writes.savePart(updatedPart);
            pendingInputParses.delete(existingPart.metadata.id);
          } else if (existingPart) {
            // Unexpected state, but don't throw - just log
            getWorkspaceConfig().captureException(
              new Error("Unexpected tool call state"),
              {
                area: "llm-request",
                chatId: input.chatId,
                data: { existingPartState: existingPart.state },
                toolCallId: part.toolCallId,
                toolName: part.toolName,
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
            await writes.savePart(newPart);
          }
          break;
        }
        case "tool-error": {
          // Still happens even without execute if parameters are invalid
          const toolCall = toolCalls[part.toolCallId];
          const invalidCallError = invalidToolCallErrors.get(part.toolCallId);
          const errorText =
            invalidCallError instanceof Error
              ? bareErrorMessage(invalidCallError)
              : typeof part.error === "string"
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
                    ? part.input
                    : toolCall.input,
                metadata: {
                  ...toolCall.metadata,
                  endedAt: getCurrentDate(),
                },
                ...providerMetadataProps,
                providerExecuted: part.providerExecuted,
                state: "output-error",
              };
              toolCalls[part.toolCallId] = updatedPart;
              await writes.savePart(updatedPart);
              pendingInputParses.delete(toolCall.metadata.id);
              continue;
            } else {
              // Unexpected state, capture exception
              getWorkspaceConfig().captureException(
                new Error("Unexpected tool error state"),
                {
                  area: "llm-request",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                },
              );
            }
          } else {
            await writes.savePart({
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
              state: "output-error",
              toolCallId: part.toolCallId,
              type: "tool-unavailable",
            });
          }
          break;
        }
        case "tool-input-delta": {
          const toolCall = toolCalls[part.id];
          if (toolCall?.state === "input-streaming") {
            toolCallInputText[part.id] =
              (toolCallInputText[part.id] || "") + part.delta;
            if (inputParseDue(toolCall.metadata.id, part.delta.length)) {
              const { value: partialArgs } = await parsePartialJson(
                toolCallInputText[part.id] ?? "",
              );
              const updatedPart: SessionMessagePart.ToolPart = {
                ...toolCall,
                input: partialArgs as never,
              };
              toolCalls[part.id] = updatedPart;
              await writes.savePart(updatedPart);
            }
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
          await writes.savePart(newPart);
          break;
        }
        case "tool-output-denied": {
          getWorkspaceConfig().captureException(
            new Error("Unexpected tool output denied"),
            {
              area: "llm-request",
              chatId: input.chatId,
              data: { part },
              sessionId: input.sessionId,
            },
          );
          break;
        }
        case "tool-result": {
          throw new Error(`Unexpected tool result: ${JSON.stringify(part)}`);
        }
        case "tool-approval-request": {
          getWorkspaceConfig().captureException(
            new Error("Unexpected tool approval request"),
            {
              area: "llm-request",
              chatId: input.chatId,
              data: { part },
              sessionId: input.sessionId,
            },
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
    // The stream can end on the very save that found the disk full.
    if (storageFullError !== undefined) {
      throw storageFullError;
    }
  } catch (error) {
    switch (true) {
      case isStorageFullError(error): {
        reportStorageError(error);
        assistantMessage.metadata.error = {
          kind: "disk-full",
          message: error.message,
        };
        break;
      }
      case error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"): {
        // Not sure if we hit this, I wasn't able to reproduce it. A timeout
        // thrown from below is one; an abort is ours to explain only when our
        // own signal fired.
        assistantMessage.metadata.error = {
          kind: "aborted",
          message: error.message,
          reason:
            error.name === "TimeoutError"
              ? "timeout"
              : signal.aborted
                ? abortReason()
                : "unknown",
        };
        break;
      }
      case LoadAPIKeyError.isInstance(error): {
        // Pretty sure this is impossible, but opencode does it
        assistantMessage.metadata.error = {
          kind: "api-key",
          message: error.message,
        };
        break;
      }
      case APICallError.isInstance(error): {
        const classification = classifyProviderError(error);
        const cause = describeErrorCause(error);
        assistantMessage.metadata.error = {
          cause,
          classification: classification.kind,
          kind: "api-call",
          message: error.message,
          name: error.name,
          responseBody: error.responseBody,
          statusCode: error.statusCode,
          url: error.url,
        };
        // A response arrived and then could not be read: a stream dropped
        // partway, or a body that would not parse. A provider's own refusal
        // carries no cause, and a request that never connected no status.
        if (error.statusCode !== undefined && cause !== undefined) {
          getWorkspaceConfig().captureException(error, {
            area: "llm-request",
            chatId: input.chatId,
            data: { classification: classification.kind },
            sessionId: input.sessionId,
          });
        }
        break;
      }
      // Should not be called now that tool-error above handles this
      case InvalidToolInputError.isInstance(error): {
        assistantMessage.metadata.error = {
          input: error.toolInput,
          kind: "invalid-tool-input",
          message: error.message,
        };
        break;
      }
      // Should not be called now that tool-error above handles this
      case NoSuchToolError.isInstance(error): {
        assistantMessage.metadata.error = {
          kind: "no-such-tool",
          message: error.message,
          toolName: error.toolName,
        };
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
          cause: describeErrorCause(error),
          classification: classification.kind,
          kind: "unknown",
          message:
            error instanceof Error ? error.message : JSON.stringify(error),
        };
        if (classification.kind === "unknown") {
          getWorkspaceConfig().captureException(error, {
            area: "llm-request",
            chatId: input.chatId,
            sessionId: input.sessionId,
          });
        }
      }
    }

    assistantMessage.metadata.finishedAt = getCurrentDate();
    assistantMessage.metadata.msToFinish ??= msSinceRequestStart();
    await writes.saveMessage(assistantMessage);
  }

  // Remove abort listener since we've completed
  signal.removeEventListener("abort", abortListener);
  const ranOutOfRoom = assistantMessage.metadata.finishReason === "length";
  // The fragments that arrived since the last parse, so a call the turn is
  // about to let go of carries everything the model typed rather than
  // whatever the cadence last read. A call the output limit stopped in the
  // middle of is settled here rather than left arriving: nothing is coming,
  // and a result is what the next step reads.
  for (const [id, call] of Object.entries(toolCalls)) {
    if (call.state !== "input-streaming") {
      continue;
    }
    const { value: typed } = await parsePartialJson(
      toolCallInputText[id] ?? "",
    );
    await writes.savePart(
      ranOutOfRoom
        ? {
            ...call,
            errorText: CUT_OFF_CALL_TEXT,
            input: typed as never,
            metadata: { ...call.metadata, endedAt: getCurrentDate() },
            state: "output-error",
          }
        : { ...call, input: typed as never },
    );
  }
  if (ranOutOfRoom) {
    // A call the output limit cut off part way through its arguments reaches
    // the provider as malformed JSON, and the SDK's own message for that says
    // the input was invalid. The next step reads that as its own mistake and
    // rewrites arguments that were right. Say what happened instead.
    for (const part of await getCurrentParts()) {
      if (
        isToolPart(part) &&
        part.state === "output-error" &&
        invalidToolCallErrors.has(part.toolCallId)
      ) {
        await writes.savePart({ ...part, errorText: CUT_OFF_CALL_TEXT });
      }
    }
  }
  // The request is over, so what it was holding is written: every part that
  // settled is in the records already, since each write here was waited for,
  // and whatever was still arriving is written as the request left it, which
  // is how a reply cut off mid-word is still a reply the person can read.
  // Only this reply's: a request returning after its caller moved on to
  // another attempt leaves that attempt's parts arriving.
  await live?.clear(assistantMessage.id);

  const parts = await getCurrentParts();
  // Detection only, and after the turn has let go: a call still arriving at
  // this point was settled as cut off, so one that reads `input-streaming`
  // here is a leftover the turn's own ending did not cover.
  for (const part of parts) {
    if (isToolPart(part) && part.state === "input-streaming") {
      getWorkspaceConfig().captureException(
        new Error("Unhandled tool input streaming part"),
        {
          area: "llm-request",
          data: {
            assistantErrorKind: assistantMessage.metadata.error?.kind,
            inputStreamCharCount: toolCallInputText[part.toolCallId]?.length,
            partHasInput: part.input !== undefined,
            partId: part.metadata.id,
            partType: part.type,
            providerExecuted: part.providerExecuted,
          },
          messageId: assistantMessage.id,
          modelId,
          providerId,
          sessionId: input.sessionId,
          toolCallId: part.toolCallId,
        },
      );
    }
  }

  return { message: assistantMessage, parts };
});

/** What a tool call stopped part way through by the output limit answers with. */
const CUT_OFF_CALL_TEXT =
  "The output limit cut this call off before its input was complete, so it did not run. Call it again.";

/**
 * An error's message with every cause it embeds reduced to that cause's own
 * message. The AI SDK writes a cause into its parent's message as
 * `Name: message`, so an invalid tool call reads `AI_InvalidToolInputError:
 * Invalid input for tool read_file: AI_TypeValidationError: ...`, and this
 * text goes back to the model as the tool's result. SDK class names tell a
 * model nothing it can act on.
 */
function bareErrorMessage(error: Error): string {
  const { cause } = error;
  if (!(cause instanceof Error)) {
    return error.message;
  }
  return error.message.replace(String(cause), bareErrorMessage(cause));
}

/**
 * Whether a stream part belongs to a hosted search the provider ran inside the
 * step (`nativeSearchTools`), which is neither stored nor run here. The
 * provider marks only the call as its own, so a call is known from its first
 * part by the tool's name, and its later parts by the id that part gave.
 */
function isNativeSearchPart(
  part: TextStreamPart<ToolSet>,
  /** The tools this app runs, undefined when nothing searches natively. */
  ownToolNames: ReadonlySet<string> | undefined,
  nativeCallIds: Set<string>,
): boolean {
  if (!ownToolNames) {
    return false;
  }
  // Known by not being one of ours rather than by a list of the provider's
  // names, so a search step it adds later is skipped too.
  switch (part.type) {
    case "tool-input-start": {
      if (ownToolNames.has(part.toolName)) {
        return false;
      }
      nativeCallIds.add(part.id);
      return true;
    }
    case "tool-input-delta":
    case "tool-input-end": {
      return nativeCallIds.has(part.id);
    }
    case "tool-call": {
      // Only the provider's own calls are its searches. A call the model made
      // to a tool that does not exist goes on to be refused as one, so the
      // model hears why, though its input was skipped.
      if (!part.providerExecuted) {
        nativeCallIds.delete(part.toolCallId);
        return false;
      }
      if (!ownToolNames.has(part.toolName)) {
        nativeCallIds.add(part.toolCallId);
      }
      return nativeCallIds.has(part.toolCallId);
    }
    case "tool-error":
    case "tool-result": {
      if (part.providerExecuted && !ownToolNames.has(part.toolName)) {
        nativeCallIds.add(part.toolCallId);
      }
      return nativeCallIds.has(part.toolCallId);
    }
    default: {
      return false;
    }
  }
}
