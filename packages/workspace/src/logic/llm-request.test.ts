import {
  APICallError,
  type LanguageModelV4Prompt,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import {
  type AIProviderType,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { errAsync } from "neverthrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  setup,
  waitFor,
} from "xstate";

import { UNTITLED_CHAT_TITLE } from "../constants";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { TypedError } from "../lib/errors";
import { getErrorAction } from "../lib/get-error-action";
import { isToolPart } from "../lib/is-tool-part";
import { type ChatRead } from "../lib/records/chat-records";
import { logFileName } from "../lib/records/file-names";
import { liveView } from "../lib/records/views";
import { turnNoteFor } from "../lib/turn-note";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../lib/llm-token-limits";
import { mediaDigest } from "../lib/refused-media";
import { SESSION_CONTEXT_VERSION } from "../lib/session-baseline";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { RelativePathSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { withRecordsInPlace } from "../test/helpers/with-test-records";
import { TOOLS } from "../tools/all";
import { llmRequestLogic } from "./llm-request";

vi.mock(import("ulid"));

vi.mock(import("../lib/get-current-date"));
vi.mock(import("../lib/turn-note"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, turnNoteFor: vi.fn(original.turnNoteFor) };
});

/** A message's parts, written one after another. */
async function saveParts(
  parts: SessionMessagePart.Type[],
  chatId: ChatId,
): Promise<void> {
  for (const part of parts) {
    (await ChatWrites.savePart(part, chatId))._unsafeUnwrap();
  }
}

describe("llmRequestLogic", () => {
  const sessionId = StoreId.newSessionId();
  /** Numbers each case's chat. */
  let chats = 0;
  /**
   * A chats folder of this run's own. The mock config's is a fixed folder
   * under the system temp directory, where the logs of every past run are
   * still there to be folded, so a case taking its chat by number would be
   * handed whatever the run before it wrote under that name.
   */
  let chatsDir = "";
  const mockUsage = {
    inputTokens: {
      cacheRead: 1,
      cacheWrite: undefined,
      noCache: undefined,
      total: 2,
    },
    outputTokens: {
      reasoning: 4,
      text: undefined,
      total: 3,
    },
  };
  const mockTotalUsage = {
    inputTokenDetails: {
      cacheReadTokens: 1,
      cacheWriteTokens: undefined,
      noCacheTokens: undefined,
    },
    inputTokens: 2,
    outputTokenDetails: {
      reasoningTokens: 4,
      textTokens: undefined,
    },
    outputTokens: 3,
    totalTokens: 5,
  };
  let prompts: LanguageModelV4Prompt[] = [];
  const mockDate = new Date("2013-08-31T12:00:00.000Z");
  const mockMessageId = StoreId.newMessageId();
  const mockMessages: SessionMessage.ContextWithParts[] = [
    {
      id: mockMessageId,
      metadata: {
        agentName: "main",
        createdAt: mockDate,
        realRole: "assistant",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: mockDate,
            id: StoreId.newPartId(),
            messageId: mockMessageId,
            sessionId,
          },
          text: "You are a helpful assistant.",
          type: "text",
        },
      ],
      role: "session-context",
    },
  ];

  beforeAll(async () => {
    chatsDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "llm-request-chats-")),
    );
  });

  afterAll(async () => {
    await fs.rm(chatsDir, { force: true, recursive: true });
  });

  beforeEach(() => {
    prompts = [];
  });

  async function createTestMachine({
    beforeStream,
    catalog,
    chunks,
    finishReason = "stop",
    getMessages = () => Promise.resolve(mockMessages),
    modelFeatures,
    modelProvider,
    onChunkReceived,
    provider = OUR_PROVIDER_CONFIG.type,
  }: {
    beforeStream?: (prompt: LanguageModelV4Prompt) => Promise<void>;
    catalog?: AIGatewayModel.Type[];
    chunks: LanguageModelV4StreamPart[];
    finishReason?: "length" | "stop";
    getMessages?: () => Promise<SessionMessage.ContextWithParts[]>;
    modelFeatures?: AIGatewayModel.ModelFeatures[];
    /** The connection the chat's model is on, where it differs from `provider`'s. */
    modelProvider?: AIProviderType;
    onChunkReceived?: () => void;
    provider?: AIProviderType;
  }) {
    const mockLanguageModel = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        if (beforeStream) {
          await beforeStream(prompt);
        }
        prompts.push(prompt);
        return {
          stream: simulateReadableStream({
            chunks: [
              ...chunks,
              {
                finishReason: { raw: finishReason, unified: finishReason },
                logprobs: undefined,
                type: "finish",
                usage: {
                  inputTokens: {
                    cacheRead: undefined,
                    cacheWrite: undefined,
                    noCache: undefined,
                    total: 3,
                  },
                  outputTokens: {
                    reasoning: undefined,
                    text: undefined,
                    total: 10,
                  },
                },
              },
            ],
          }),
        };
      },
      provider,
    });

    const model = createMockAIGatewayModel({
      features: modelFeatures,
      provider:
        modelProvider ??
        (provider === "anthropic" ? "anthropic" : OUR_PROVIDER_CONFIG.type),
    });

    // A chat of this case's own: every case writes into the same session, and
    // a chat's records are read back whole, so a shared chat would hand a case
    // the one before it as well.
    const taskConfig = createMockChatConfigForDir(
      path.join(chatsDir, `mock-${++chats}`),
      {
        aiSDKModel: mockLanguageModel,
        catalog,
        model,
      },
    );
    await ChatWrites.saveSession(
      {
        createdAt: mockDate,
        id: sessionId,
        title: UNTITLED_CHAT_TITLE,
      },
      taskConfig,
    );

    // Aborted the way the agent machine aborts a request it waits for, with
    // why: its one stop here.
    const requestStop = new AbortController();
    const machine = setup({
      actors: { llmRequest: llmRequestLogic },
      types: {
        events: {} as { type: "stop" },
      },
    }).createMachine({
      initial: "Start",
      on: {
        "*": {
          actions: ({ event }) => {
            throw new Error(`Unknown event ${event.type}`);
          },
        },
        stop: {
          actions: () => {
            requestStop.abort("manual");
          },
        },
      },
      states: {
        Done: { type: "final" },
        Error: { type: "final" },
        Start: {
          invoke: {
            input: () => ({
              agent: {
                agentTools: {},
                getMessages,
                getTools: () => Promise.resolve(Object.values(TOOLS)),
                name: "instrument",
                onFinish: () => Promise.resolve(),
                onStart: () => Promise.resolve(),
                shouldContinue: () => Promise.resolve(true),
                systemPrompt: () => "You are a helpful assistant.",
              },
              emitDeltas: true,
              model,
              self: {
                send: vi.fn(() => onChunkReceived?.()),
              } as unknown as AnyActorRef,
              sessionId,
              stepCount: 1,
              stop: requestStop.signal,
              chatId: taskConfig,
            }),
            onDone: "Done",
            onError: {
              actions: () => {
                throw new Error("Error");
              },
            },
            src: "llmRequest",
          },
        },
      },
    });

    return { machine, mockLanguageModel, chatId: taskConfig };
  }

  async function runTestMachine({
    machine,
    chatId,
  }: Pick<
    Awaited<ReturnType<typeof createTestMachine>>,
    "machine" | "chatId"
  >) {
    const actor = createActor(machine);
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    const sessionResult = await ChatReads.sessionWithMessages({
      chatId,
      sessionId,
    });
    return sessionResult._unsafeUnwrap();
  }

  async function createAndRunTestMachine(
    params: Parameters<typeof createTestMachine>[0],
  ) {
    const testMachine = await createTestMachine(params);
    return runTestMachine(testMachine);
  }

  function messagesToSnapshot(messages: SessionMessage.WithParts[]) {
    return messages.map((message) => {
      if ("metadata" in message && "aiGatewayModel" in message.metadata) {
        const {
          aiGatewayModel: _aiGatewayModel,
          createdAt: _createdAt,
          finishedAt: _finishedAt,
          modelId: _modelId,
          msToFinish: _msToFinish,
          msToFirstChunk: _msToFirstChunk,
          providerId: _providerId,
          usage: _usage,
          ...metadata
        } = message.metadata;
        return {
          ...message,
          metadata,
        };
      }
      // The context every case starts from, written as it was given: one
      // line, so each snapshot shows what the case changed.
      if (
        message.role === "session-context" &&
        "contextVersion" in message.metadata &&
        message.metadata.contextVersion === SESSION_CONTEXT_VERSION &&
        message.parts.length === 1 &&
        message.parts[0]?.type === "text" &&
        message.parts[0].text === "You are a helpful assistant."
      ) {
        return "session-context: You are a helpful assistant.";
      }
      return message;
    });
  }

  /**
   * The reply's parts after its step-start, without the ids and times every
   * part has: what the case's stream turned into.
   */
  function replyParts(messages: SessionMessage.WithParts[]) {
    const reply = messages.at(-1);
    return (reply?.role === "assistant" ? reply.parts : [])
      .filter((part) => part.type !== "step-start")
      .map(({ metadata: _metadata, ...part }) => part);
  }

  /** How the reply ended. */
  function replyEnd(messages: SessionMessage.WithParts[]) {
    const reply = messages.at(-1);
    return reply?.role === "assistant"
      ? {
          error: reply.metadata.error,
          finishReason: reply.metadata.finishReason,
        }
      : undefined;
  }

  it("writes streamed text as one done text part after the step's start", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "1", type: "text-start" },
        { delta: "Hello, ", id: "1", type: "text-delta" },
        { delta: "world!", id: "1", type: "text-delta" },
        { id: "1", type: "text-end" },
        {
          finishReason: { raw: "stop", unified: "stop" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        "session-context: You are a helpful assistant.",
        {
          "id": "msg_00000000Z88888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.4285714285714286,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000Z88888888888888889",
                "messageId": "msg_00000000Z88888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:11.000Z,
                "id": "prt_00000000Z8888888888888888A",
                "messageId": "msg_00000000Z88888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "done",
              "text": "Hello, world!",
              "type": "text",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("records a streamed tool call as input-available, with its provider metadata", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "test-call-1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ filePath: "test-file.txt" }),
          providerMetadata: {
            anthropic: { cacheReadInputTokens: 50 },
          },
          toolCallId: "test-call-1",
          toolName: "read_file",
          type: "tool-call",
        },
      ],
    });
    expect(replyParts(messages)).toMatchInlineSnapshot(`
      [
        {
          "callProviderMetadata": {
            "anthropic": {
              "cacheReadInputTokens": 50,
            },
          },
          "input": {
            "filePath": "test-file.txt",
          },
          "state": "input-available",
          "toolCallId": "test-call-1",
          "type": "tool-read_file",
        },
      ]
    `);
  });

  it("joins reasoning deltas into one done reasoning part", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "1", type: "reasoning-start" },
        { delta: "First, I need", id: "1", type: "reasoning-delta" },
        { delta: " to consider", id: "1", type: "reasoning-delta" },
        { id: "1", type: "reasoning-end" },
      ],
    });
    expect(replyParts(messages)).toMatchInlineSnapshot(`
      [
        {
          "state": "done",
          "text": "First, I need to consider",
          "type": "reasoning",
        },
      ]
    `);
  });

  it("records url and document sources", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "test-source-id",
          sourceType: "url",
          title: "Test Source",
          type: "source",
          url: "https://example.com/test-source",
        },
        {
          filename: "test-document.pdf",
          id: "test-doc-id",
          mediaType: "application/pdf",
          sourceType: "document",
          title: "Test Document",
          type: "source",
        },
      ],
    });
    expect(replyParts(messages)).toMatchInlineSnapshot(`
      [
        {
          "sourceId": "test-source-id",
          "title": "Test Source",
          "type": "source-url",
          "url": "https://example.com/test-source",
        },
        {
          "filename": "test-document.pdf",
          "mediaType": "application/pdf",
          "sourceId": "test-doc-id",
          "title": "Test Document",
          "type": "source-document",
        },
      ]
    `);
  });

  const readFileStart = {
    id: "1",
    toolName: "read_file",
    type: "tool-input-start",
  } as const;
  const readFileCall = (input: string) =>
    ({
      input,
      toolCallId: "1",
      toolName: "read_file",
      type: "tool-call",
    }) as const;

  it.each([
    [
      "input with the wrong key",
      [readFileStart, readFileCall(JSON.stringify({ invalid: "params" }))],
      /^Invalid input for tool read_file: Type validation failed/,
    ],
    [
      "input with the wrong key and no start part",
      [readFileCall(JSON.stringify({ invalid: "params" }))],
      /^Invalid input for tool read_file: Type validation failed/,
    ],
    [
      "input that is not JSON",
      [readFileStart, readFileCall("invalid json")],
      /^Invalid input for tool read_file: JSON parsing failed/,
    ],
  ])(
    "fails a call with %s, telling the model why",
    async (_label, chunks, errorText) => {
      const { messages } = await createAndRunTestMachine({ chunks });
      expect(replyParts(messages)).toEqual([
        expect.objectContaining({
          errorText: expect.stringMatching(errorText),
          state: "output-error",
          type: "tool-read_file",
        }),
      ]);
    },
  );

  it.each([
    ["a call with broken JSON", readFileCall('{"filePath": "./lease')],
    [
      "input still arriving",
      { delta: '{"filePath": "./le', id: "1", type: "tool-input-delta" },
    ],
  ] as const)(
    "tells the model the output limit cut off %s, rather than that its input was invalid",
    async (_label, cut) => {
      const { messages } = await createAndRunTestMachine({
        chunks: [readFileStart, cut],
        finishReason: "length",
      });
      expect(
        replyParts(messages).map((part) => ({
          errorText: "errorText" in part ? part.errorText : undefined,
          state: "state" in part ? part.state : undefined,
        })),
      ).toMatchInlineSnapshot(`
        [
          {
            "errorText": "The output limit cut this call off before its input was complete, so it did not run. Call it again.",
            "state": "output-error",
          },
        ]
      `);
    },
  );

  it("records a call to an unknown tool that never arrived as cut off", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "1", toolName: "non_existent_tool", type: "tool-input-start" },
      ],
    });
    expect(replyParts(messages)).toMatchInlineSnapshot(`
      [
        {
          "errorText": "This action was cut off before it could run.",
          "state": "output-error",
          "toolCallId": "1",
          "type": "tool-unavailable",
        },
      ]
    `);
  });

  const unknownCall = {
    input: JSON.stringify({ filePath: "test.txt" }),
    toolCallId: "1",
    toolName: "non_existent_tool",
    type: "tool-call",
  } as const;

  it.each([
    [
      "its own start part",
      [{ ...readFileStart, toolName: "non_existent_tool" }, unknownCall],
    ],
    ["a start part naming another tool", [readFileStart, unknownCall]],
    ["no start part", [unknownCall]],
  ] as const)(
    "fails a call to an unknown tool after %s, naming the tools there are",
    async (_label, chunks) => {
      const { messages } = await createAndRunTestMachine({
        chunks: [...chunks],
      });
      expect(replyParts(messages)).toEqual([
        expect.objectContaining({
          errorText: expect.stringMatching(
            /^Model tried to call unavailable tool 'non_existent_tool'\. Available tools: .*\bread_file\b/,
          ),
          input: { filePath: "test.txt" },
          state: "output-error",
          type: "tool-unavailable",
        }),
      ]);
    },
  );

  describe("stream errors", () => {
    it("records an API error on the reply, classified", async () => {
      const { messages } = await createAndRunTestMachine({
        beforeStream: () => {
          throw new APICallError({
            cause: new Error("API call failed"),
            message: "Failed to process error response",
            requestBodyValues: {},
            responseHeaders: {},
            statusCode: 500,
            url: "https://api.openai.com/v1/chat/completions",
          });
        },
        chunks: [],
      });
      expect(replyEnd(messages)).toMatchInlineSnapshot(`
        {
          "error": {
            "cause": "Error: API call failed",
            "classification": "transient",
            "kind": "api-call",
            "message": "Failed to process error response",
            "name": "AI_APICallError",
            "statusCode": 500,
            "url": "https://api.openai.com/v1/chat/completions",
          },
          "finishReason": "unknown",
        }
      `);
    });

    it("keeps why a dropped stream failed and reports it", async () => {
      const socket = Object.assign(new Error("other side closed"), {
        code: "UND_ERR_SOCKET",
        name: "SocketError",
      });
      // As the SDK's `handleFetchError` rebuilds it: retryable, since a
      // network error is in its chain.
      const dropped = new APICallError({
        cause: new TypeError("terminated", { cause: socket }),
        isRetryable: true,
        message: "Failed to process successful response",
        requestBodyValues: {},
        statusCode: 200,
        url: "http://127.0.0.1:48100/ai-gateway/providers/instrument/chat/completions",
      });
      const testMachine = await createTestMachine({
        beforeStream: () => {
          throw dropped;
        },
        chunks: [],
      });
      const captureException = vi
        .spyOn(getWorkspaceConfig(), "captureException")
        .mockImplementation(() => {});

      const { messages } = await runTestMachine(testMachine);

      expect(captureException).toHaveBeenCalledWith(
        dropped,
        expect.objectContaining({ area: "llm-request" }),
      );
      expect(replyEnd(messages)?.error).toMatchObject({
        cause:
          "TypeError: terminated, caused by SocketError: other side closed (UND_ERR_SOCKET)",
      });
    });

    it("does not report a provider's refusal", async () => {
      const testMachine = await createTestMachine({
        beforeStream: () => {
          throw new APICallError({
            message: "Overloaded",
            requestBodyValues: {},
            responseBody: '{"error":{"type":"overloaded_error"}}',
            statusCode: 529,
            url: "https://api.anthropic.com/v1/messages",
          });
        },
        chunks: [],
      });
      const captureException = vi
        .spyOn(getWorkspaceConfig(), "captureException")
        .mockImplementation(() => {});

      await runTestMachine(testMachine);

      expect(captureException).not.toHaveBeenCalled();
    });

    it("records a stopped request as aborted, with the time it ran", async () => {
      let actor: ActorRefFrom<typeof testMachine.machine> | null = null;
      const testMachine = await createTestMachine({
        beforeStream: async () => {
          actor?.send({ type: "stop" });
          await Promise.resolve();
        },
        chunks: [],
      });

      actor = createActor(testMachine.machine);
      actor.start();
      await waitFor(actor, (state) => state.status === "done");
      const sessionResult = await ChatReads.sessionWithMessages({
        chatId: testMachine.chatId,
        sessionId,
      });
      const messages = sessionResult._unsafeUnwrap().messages;
      expect(replyEnd(messages)).toMatchInlineSnapshot(`
        {
          "error": {
            "kind": "aborted",
            "message": "Aborted",
            "reason": "manual",
          },
          "finishReason": "aborted",
        }
      `);
      // A turn stopped part way through spent the time it spent, and
      // reporting nothing for it reads as a turn that was instant.
      const aborted = messages.at(-1);
      expect(
        aborted?.role === "assistant" ? aborted.metadata.msToFinish : undefined,
      ).toMatchInlineSnapshot(`4000`);
    });

    it("records an error it does not know as unknown", async () => {
      const { messages } = await createAndRunTestMachine({
        beforeStream: () => {
          throw new Error("Unknown error");
        },
        chunks: [],
      });
      expect(replyEnd(messages)).toMatchInlineSnapshot(`
        {
          "error": {
            "classification": "unknown",
            "kind": "unknown",
            "message": "Unknown error",
          },
          "finishReason": "unknown",
        }
      `);
    });

    it("names a throttle reported inside a 200 stream", async () => {
      // Recorded verbatim from a task that hit this. The request succeeded, so
      // no `APICallError` is ever raised: the whole rejection is one chunk.
      const { messages } = await createAndRunTestMachine({
        chunks: [
          {
            error: {
              code: 429,
              message:
                "openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
              metadata: { error_type: "rate_limit_exceeded" },
            },
            type: "error",
          },
        ],
      });

      expect(replyEnd(messages)?.error).toMatchObject({
        classification: "rate-limit",
      });
    });
  });

  describe("prompt messages", () => {
    const mockAssistantMessageMetadata = {
      createdAt: mockDate,
      finishReason: "stop" as const,
      modelId: "mock-model-id",
      providerId: "mock-provider",
      sessionId,
      usage: mockTotalUsage,
    };

    /** A text part of `messageId`. */
    const textPart = (
      messageId: StoreId.Message,
      text: string,
    ): SessionMessagePart.Type => ({
      metadata: {
        createdAt: mockDate,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      state: "done",
      text,
      type: "text",
    });

    /**
     * A chat with the user's "Do something", then an assistant message with
     * `assistantParts` (made for its id), and one assistant message per
     * entry of `replies`.
     */
    async function chatWith({
      assistantParts = () => [],
      provider,
      replies = [],
    }: {
      assistantParts?: (
        messageId: StoreId.Message,
      ) => SessionMessagePart.Type[];
      provider?: AIProviderType;
      replies?: string[];
    }) {
      const testMachine = await createTestMachine({ chunks: [], provider });
      const userMessageId = StoreId.newMessageId();
      await ChatWrites.saveMessage(
        {
          id: userMessageId,
          metadata: { createdAt: mockDate, sessionId },
          role: "user",
        },
        testMachine.chatId,
      );
      await saveParts(
        [textPart(userMessageId, "Do something")],
        testMachine.chatId,
      );
      for (const [index, text] of [undefined, ...replies].entries()) {
        const messageId = StoreId.newMessageId();
        await ChatWrites.saveMessage(
          {
            id: messageId,
            metadata: mockAssistantMessageMetadata,
            role: "assistant",
          },
          testMachine.chatId,
        );
        await saveParts(
          index === 0
            ? assistantParts(messageId)
            : [textPart(messageId, text ?? "")],
          testMachine.chatId,
        );
      }
      await runTestMachine(testMachine);
      return prompts[0] ?? [];
    }

    /** A prompt as it goes over the wire, without the keys the SDK leaves undefined. */
    const asSent = (prompt: unknown): unknown =>
      JSON.parse(JSON.stringify(prompt));

    const doneCall = (messageId: StoreId.Message) => ({
      metadata: {
        createdAt: mockDate,
        endedAt: mockDate,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
    });

    it("sends the context and the user's message, leaving out an empty reply", async () => {
      expect(asSent(await chatWith({}))).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "text": "You are a helpful assistant.",
                "type": "text",
              },
            ],
            "role": "assistant",
          },
          {
            "content": [
              {
                "text": "Do something",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ]
      `);
    });

    it("sends each tool call with its result, in the order they were made", async () => {
      const prompt = await chatWith({
        assistantParts: (messageId) => [
          {
            ...doneCall(messageId),
            input: { filePath: "./test-file.txt" },
            output: {
              content: "test-file.txt content",
              displayedLines: 10,
              filePath: RelativePathSchema.parse("./test-file.txt"),
              hasMoreLines: false,
              modifiedAt: 1_234_567_890,
              offset: 1,
              state: "exists",
              totalLines: 10,
              truncatedByBytes: false,
            },
            state: "output-available",
            toolCallId: StoreId.ToolCallSchema.parse("1"),
            type: "tool-read_file",
          },
          {
            ...doneCall(messageId),
            input: { content: "new content", filePath: "./output.txt" },
            output: {
              content: "new content",
              filePath: RelativePathSchema.parse("./output.txt"),
              isNewFile: true,
              modifiedAt: 1_234_567_890,
            },
            state: "output-available",
            toolCallId: StoreId.ToolCallSchema.parse("2"),
            type: "tool-write_file",
          },
        ],
      });
      expect(asSent(prompt.slice(2))).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "input": {
                  "filePath": "./test-file.txt",
                },
                "toolCallId": "1",
                "toolName": "read_file",
                "type": "tool-call",
              },
              {
                "input": {
                  "content": "new content",
                  "filePath": "./output.txt",
                },
                "toolCallId": "2",
                "toolName": "write_file",
                "type": "tool-call",
              },
            ],
            "role": "assistant",
          },
          {
            "content": [
              {
                "output": {
                  "type": "text",
                  "value": "<path>./test-file.txt</path>
        <content>
           1→test-file.txt content
        </content>",
                },
                "toolCallId": "1",
                "toolName": "read_file",
                "type": "tool-result",
              },
              {
                "output": {
                  "type": "text",
                  "value": "Successfully wrote new file ./output.txt",
                },
                "toolCallId": "2",
                "toolName": "write_file",
                "type": "tool-result",
              },
            ],
            "role": "tool",
          },
        ]
      `);
    });

    it("sends a failed tool call's error as its result", async () => {
      const prompt = await chatWith({
        assistantParts: (messageId) => [
          {
            ...doneCall(messageId),
            errorText:
              "File is too large (300000 bytes). Maximum size is 256000 bytes",
            input: { filePath: "./test-file.txt" },
            state: "output-error",
            toolCallId: StoreId.ToolCallSchema.parse("1"),
            type: "tool-read_file",
          },
        ],
      });
      expect(asSent(prompt.slice(3))).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "output": {
                  "type": "error-text",
                  "value": "File is too large (300000 bytes). Maximum size is 256000 bytes",
                },
                "toolCallId": "1",
                "toolName": "read_file",
                "type": "tool-result",
              },
            ],
            "role": "tool",
          },
        ]
      `);
    });

    it("marks the last messages for caching on an Anthropic model", async () => {
      const prompt = await chatWith({
        provider: "anthropic",
        replies: ["What would you like to do?", "I'm ready to help."],
      });
      expect(
        prompt.map(
          (message) =>
            `${message.role}${message.providerOptions === undefined ? "" : " (cached)"}`,
        ),
      ).toMatchInlineSnapshot(`
        [
          "assistant",
          "user",
          "assistant (cached)",
          "assistant (cached)",
        ]
      `);
      expect(prompt.at(-1)?.providerOptions).toMatchInlineSnapshot(`
        {
          "anthropic": {
            "cacheControl": {
              "type": "ephemeral",
            },
          },
          "bedrock": {
            "cachePoint": {
              "type": "ephemeral",
            },
          },
          "openaiCompatible": {
            "cache_control": {
              "type": "ephemeral",
            },
          },
        }
      `);
    });

    // The session context is the session's immutable baseline: however long ago
    // it was written, it is reused byte for byte rather than rebuilt, so the
    // prefix every later request shares with the cached one does not move.
    it("reuses session context of any age", async () => {
      const testMachine = await createTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          { delta: "Response text", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const staleDate = new Date("2013-08-31T10:00:00.000Z");
      const staleMessageId = StoreId.newMessageId();
      const oldText = "You are an assistant from two hours ago.";

      await ChatWrites.saveMessageWithParts(
        {
          id: staleMessageId,
          metadata: {
            agentName: "main",
            contextVersion: SESSION_CONTEXT_VERSION,
            createdAt: staleDate,
            realRole: "user",
            sessionId,
          },
          parts: [
            {
              metadata: {
                createdAt: staleDate,
                id: StoreId.newPartId(),
                messageId: staleMessageId,
                sessionId,
              },
              text: oldText,
              type: "text",
            },
          ],
          role: "session-context",
        },
        testMachine.chatId,
      );

      const { messages } = await runTestMachine(testMachine);
      expect(
        messages
          .filter((message) => message.role === "session-context")
          .map((message) => message.id),
        "The stored context message should be the only one, with its id intact",
      ).toEqual([staleMessageId]);
      expect(
        JSON.stringify(prompts[0]?.[0]),
        "The stored context text should reach the model unchanged",
      ).toContain(oldText);
    });
  });

  it("should cap max output tokens for normal LLM requests", async () => {
    const testMachine = await createTestMachine({
      chunks: [
        { id: "1", type: "text-start" },
        { delta: "Hello", id: "1", type: "text-delta" },
        { id: "1", type: "text-end" },
      ],
    });

    await runTestMachine(testMachine);

    expect(testMachine.mockLanguageModel.doStreamCalls).toHaveLength(1);
    expect(
      testMachine.mockLanguageModel.doStreamCalls[0]?.maxOutputTokens,
    ).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("ends reasoning where a tool call supersedes it", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "1", type: "reasoning-start" },
        { delta: "I should read the file", id: "1", type: "reasoning-delta" },
        {
          id: "test-call-1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ filePath: "test-file.txt" }),
          toolCallId: "test-call-1",
          toolName: "read_file",
          type: "tool-call",
        },
        // Providers can hold this back until the step finishes, long after the
        // tool call started.
        { id: "1", type: "reasoning-end" },
      ],
    });
    const reply = messages.at(-1);
    const parts = reply?.role === "assistant" ? reply.parts : [];
    const reasoning = parts.find((part) => part.type === "reasoning");
    const call = parts.find((part) => part.type === "tool-read_file");
    expect(reasoning?.state).toBe("done");
    expect(reasoning?.metadata.endedAt?.getTime()).toBeLessThan(
      call?.metadata.createdAt.getTime() ?? 0,
    );
  });

  // The AI SDK seeds its response metadata with the id we sent and overwrites it
  // only when the provider reports one, so an id equal to the request is not
  // evidence that anything named it. Only a difference can have come from the
  // provider, and only a difference is worth storing.
  describe("the model that served the request", () => {
    /** The served-model fields of the reply to a stream naming `modelId`. */
    async function servedModel(
      modelId: string | undefined,
      catalog?: AIGatewayModel.Type[],
    ) {
      const { messages } = await createAndRunTestMachine({
        catalog,
        chunks: [
          ...(modelId === undefined
            ? []
            : [{ modelId, type: "response-metadata" } as const]),
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });
      const reply = messages.at(-1);
      return reply?.role === "assistant"
        ? {
            aiGatewayModelServed: reply.metadata.aiGatewayModelServed?.name,
            modelIdServed: reply.metadata.modelIdServed,
          }
        : undefined;
    }

    // Nothing in the mock cache answers to that id, which is the ordinary
    // outcome for a model released between two refreshes of the list. The id
    // stands on its own and everything reading it falls back to showing it.
    it("records the served id when the provider names a different model", async () => {
      expect(await servedModel("openai/gpt-5.6-luna")).toEqual({
        aiGatewayModelServed: undefined,
        modelIdServed: "openai/gpt-5.6-luna",
      });
    });

    it("snapshots the served model's record when the catalog has one", async () => {
      const luna = createMockAIGatewayModel({
        author: "openai",
        canonicalId: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        providerId: "openai/gpt-5.6-luna",
      });
      expect(await servedModel("openai/gpt-5.6-luna", [luna])).toEqual({
        aiGatewayModelServed: "GPT-5.6 Luna",
        modelIdServed: "openai/gpt-5.6-luna",
      });
    });

    it.each([
      // OpenAI's catalog carries undated aliases and its API answers with the
      // dated build behind one, so without this a direct OpenAI key reported a
      // substitution on every single turn.
      ["pins the model we asked for to a build", "mock-model-id-2026-01-15"],
      ["names the model we asked for", "mock-model-id"],
      // Google reports nothing at all, so its every turn used to claim it had
      // been served the model we asked for.
      ["reports no model", undefined],
    ])("records nothing when the provider %s", async (_label, modelId) => {
      expect(await servedModel(modelId)).toEqual({
        aiGatewayModelServed: undefined,
        modelIdServed: undefined,
      });
    });
  });

  // A reply is held in the turn's memory while it arrives and written as it
  // settles, so what these cases watch is the cadence a call's input is
  // parsed on, and what the turn's end writes of a reply that never settled.
  // performance.now is pinned so no time ever appears to pass, which makes
  // every parse after a call's first attributable to the character threshold.
  describe("a reply still arriving", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("coalesces tool input delta saves", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const savePartSpy = vi.spyOn(ChatWrites, "savePart");
      const input = JSON.stringify({ filePath: `${"a".repeat(1000)}.txt` });
      const deltas = Array.from(
        { length: Math.ceil(input.length / 5) },
        (_, index) => input.slice(index * 5, index * 5 + 5),
      );
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "call-1", toolName: "read_file", type: "tool-input-start" },
          ...deltas.map((delta) => ({
            delta,
            id: "call-1",
            type: "tool-input-delta" as const,
          })),
          {
            input,
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-call",
          },
        ],
      });

      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      const toolPart = assistant?.parts.find(
        (part) => part.type === "tool-read_file",
      );
      expect(
        toolPart?.type === "tool-read_file" &&
          toolPart.state === "input-available"
          ? toolPart.input
          : undefined,
      ).toEqual({ filePath: `${"a".repeat(1000)}.txt` });
      // The step-start part, the part created at tool-input-start, the first
      // delta, and the tool-call save.
      expect(savePartSpy.mock.calls.length).toMatchInlineSnapshot(`4`);
    });

    it("records a call whose input never arrived as interrupted", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const input = JSON.stringify({ filePath: "flushed.txt" });
      const deltas = Array.from(
        { length: Math.ceil(input.length / 3) },
        (_, index) => input.slice(index * 3, index * 3 + 3),
      );
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "call-1", toolName: "read_file", type: "tool-input-start" },
          ...deltas.map((delta) => ({
            delta,
            id: "call-1",
            type: "tool-input-delta" as const,
          })),
          { error: "stream failed", type: "error" },
        ],
      });

      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      const toolPart = assistant?.parts.find(
        (part) => part.type === "tool-read_file",
      );
      // The turn's end settles the call it was still being told about, so a
      // reader sees a call that was cut off rather than one still arriving,
      // carrying everything the model had typed: the fragments that arrived
      // after the last parse are parsed once more on the way out.
      expect(
        toolPart?.type === "tool-read_file" && toolPart.state === "output-error"
          ? { errorText: toolPart.errorText, input: toolPart.input }
          : undefined,
      ).toMatchInlineSnapshot(`
        {
          "errorText": "This action was cut off before it could run.",
          "input": {
            "filePath": "flushed.txt",
          },
        }
      `);
    });

    it("does not overwrite a tool error with a stale streaming save", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "call-1", toolName: "read_file", type: "tool-input-start" },
          ...["inv", "alid", " json"].map((delta) => ({
            delta,
            id: "call-1",
            type: "tool-input-delta" as const,
          })),
          {
            input: "invalid json",
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-call",
          },
        ],
      });

      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      const toolPart = assistant?.parts.find(
        (part) => part.type === "tool-read_file",
      );
      expect(
        toolPart?.type === "tool-read_file" ? toolPart.state : undefined,
      ).toBe("output-error");
    });

    it("flushes the unsaved tail when the stream errors", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const deltaTexts = Array.from(
        { length: 10 },
        (_, index) => `piece-${index} `,
      );
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          ...deltaTexts.map((delta) => ({
            delta,
            id: "1",
            type: "text-delta" as const,
          })),
          { error: "stream failed", type: "error" },
        ],
      });

      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      expect(assistant?.metadata.error?.kind).toBe("unknown");
      const textPart = assistant?.parts.find((part) => part.type === "text");
      // Every delta of it, done where the stream left off: the words a reply
      // reached are written trimmed, since what it stopped mid-way through is
      // a word rather than a space.
      expect(textPart?.text).toBe(deltaTexts.join("").trimEnd());
    });

    it("flushes the unsaved tail when a delta save failed", async () => {
      // The last delta before the stream errors is refused once, so the words
      // it carried reach the records only through what the turn's end writes
      // of what it was holding.
      let nowMs = 0;
      vi.spyOn(performance, "now").mockImplementation(() => {
        nowMs += 1000;
        return nowMs;
      });
      const deltaTexts = ["first ", "second ", "third"];
      const fullText = deltaTexts.join("");
      const savePart = ChatWrites.savePart;
      let rejectedWrite = false;
      vi.spyOn(ChatWrites, "savePart").mockImplementation((part, chatId) => {
        if (!rejectedWrite && part.type === "text" && part.text === fullText) {
          rejectedWrite = true;
          return errAsync(new TypedError.Storage("Write failed"));
        }
        return savePart(part, chatId);
      });

      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          ...deltaTexts.map((delta) => ({
            delta,
            id: "1",
            type: "text-delta" as const,
          })),
          { error: "stream failed", type: "error" },
        ],
      });

      expect(rejectedWrite).toBe(true);
      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      const textPart = assistant?.parts.find((part) => part.type === "text");
      expect(textPart?.text).toBe(fullText);
    });

    it("ends the request on a full disk, reporting it once", async () => {
      let nowMs = 0;
      vi.spyOn(performance, "now").mockImplementation(() => {
        nowMs += 1000;
        return nowMs;
      });
      const savePart = ChatWrites.savePart;
      const savePartSpy = vi
        .spyOn(ChatWrites, "savePart")
        .mockImplementation((part, chatId) =>
          part.type === "text"
            ? errAsync(
                new TypedError.Storage("unable to open database file", {
                  cause: Object.assign(
                    new Error("unable to open database file"),
                    { code: "ERR_SQLITE_ERROR", errcode: 14 },
                  ),
                }),
              )
            : savePart(part, chatId),
        );
      const testMachine = await createTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          ...Array.from({ length: 50 }, (_, index) => ({
            delta: `word-${index} `,
            id: "1",
            type: "text-delta" as const,
          })),
          { id: "1", type: "text-end" },
        ],
      });
      const captureException = vi.spyOn(
        getWorkspaceConfig(),
        "captureException",
      );

      const { messages } = await runTestMachine(testMachine);

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(
        savePartSpy.mock.calls.filter(([part]) => part.type === "text"),
      ).toHaveLength(1);
      const assistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      expect(assistant?.metadata.error).toMatchInlineSnapshot(`
        {
          "kind": "disk-full",
          "message": "unable to open database file",
        }
      `);
    });

    // One unit of the loop GLM 5.3 Flash was captured in, as a provider
    // streams it: enough of it to run several minutes at that model's speed.
    const loopDeltas = Array.from(
      { length: 400 },
      () =>
        "— **Loading the spreadsheet skill** — I need to load the spreadsheet skill first. — `load_skill` spreadsheet ",
    );

    it.each(["text", "reasoning"] as const)(
      "ends the turn when its %s falls into a loop, without retrying",
      async (channel) => {
        vi.spyOn(performance, "now").mockReturnValue(0);
        const { messages } = await createAndRunTestMachine({
          chunks: [
            { id: "1", type: `${channel}-start` },
            ...loopDeltas.map((delta) => ({
              delta,
              id: "1",
              type: `${channel}-delta` as const,
            })),
            { id: "1", type: `${channel}-end` },
          ],
        });

        expect(prompts).toHaveLength(1);
        const assistant = messages.findLast(
          (message) => message.role === "assistant",
        );
        expect({
          error: assistant?.metadata.error,
          finishReason: assistant?.metadata.finishReason,
        }).toMatchInlineSnapshot(`
          {
            "error": {
              "kind": "repetition",
              "message": "The reply kept repeating itself and was stopped",
            },
            "finishReason": "error",
          }
        `);
        // Stopped a few windows in rather than at the stream's end.
        const streamed = assistant?.parts.find((part) => part.type === channel);
        expect(
          streamed && "text" in streamed ? streamed.text.length : 0,
        ).toBeLessThan(loopDeltas.join("").length / 2);
      },
    );

    it("leaves a tool call's repetitive input alone", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const content = "0,0,0,0\n".repeat(4000);
      const input = JSON.stringify({ content, filePath: "zeros.csv" });
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "call-1", toolName: "write_file", type: "tool-input-start" },
          ...Array.from(
            { length: Math.ceil(input.length / 100) },
            (_, index) => ({
              delta: input.slice(index * 100, (index + 1) * 100),
              id: "call-1",
              type: "tool-input-delta" as const,
            }),
          ),
          { id: "call-1", type: "tool-input-end" },
          {
            input,
            toolCallId: "call-1",
            toolName: "write_file",
            type: "tool-call",
          },
        ],
      });

      const assistant = messages.find((message) =>
        message.parts.some((part) => part.type === "tool-write_file"),
      );
      expect(assistant?.role).toBe("assistant");
      expect(
        assistant?.role === "assistant" ? assistant.metadata.error : "none",
      ).toBeUndefined();
    });

    it("flushes the unsaved tail when the request is aborted", async () => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const deltaTexts = Array.from(
        { length: 10 },
        (_, index) => `piece-${index} `,
      );
      let chunksReceived = 0;
      let actor: ActorRefFrom<typeof testMachine.machine> | null = null;
      const testMachine = await createTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          ...deltaTexts.map((delta) => ({
            delta,
            id: "1",
            type: "text-delta" as const,
          })),
        ],
        onChunkReceived: () => {
          chunksReceived += 1;
          // "start", "start-step", and "text-start" arrive first, then the
          // deltas: abort while the last delta is being processed, so the
          // reply is still arriving when the turn is let go.
          if (chunksReceived === deltaTexts.length + 3) {
            actor?.send({ type: "stop" });
          }
        },
      });

      actor = createActor(testMachine.machine);
      actor.start();
      await waitFor(actor, (state) => state.status === "done");

      // The aborted request keeps running detached from the machine, so poll
      // until what it was holding has been written.
      await vi.waitFor(async () => {
        const sessionResult = await ChatReads.sessionWithMessages({
          chatId: testMachine.chatId,
          sessionId,
        });
        const assistant = sessionResult
          ._unsafeUnwrap()
          .messages.findLast((message) => message.role === "assistant");
        expect(assistant?.metadata.finishReason).toBe("aborted");
        const textPart = assistant?.parts.find((part) => part.type === "text");
        expect(textPart?.text).toBe(deltaTexts.join("").trimEnd());
      });
    });
  });

  it("runs a shell command streamed as a tool name as the bash call it meant", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "call-1",
          toolName: "instrument task new",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ name: "Scan notes" }),
          toolCallId: "call-1",
          toolName: "instrument task new",
          type: "tool-call",
        },
        {
          finishReason: { raw: "tool_use", unified: "tool-calls" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(
      messages
        .flatMap((message) => message.parts)
        .filter((part) => "toolCallId" in part)
        .map((part) => ({ input: part.input, type: part.type })),
    ).toMatchInlineSnapshot(`
      [
        {
          "input": {
            "command": "instrument task new",
            "yieldMs": 30000,
          },
          "type": "tool-bash",
        },
      ]
    `);
  });

  // A Claude account's process compares each request with the last one it
  // saw, and the note is gone by the next step; counted as seen, it reads
  // as an edited message and restarts the process from a replay.
  it("sends the turn note as transient", async () => {
    const testMachine = await createTestMachine({ chunks: [] });
    const messageId = StoreId.newMessageId();
    await ChatWrites.saveMessage(
      {
        id: messageId,
        metadata: { createdAt: mockDate, sessionId },
        role: "user",
      },
      testMachine.chatId,
    );
    await saveParts(
      [
        {
          metadata: {
            createdAt: mockDate,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          state: "done",
          text: "Do something",
          type: "text",
        },
      ],
      testMachine.chatId,
    );
    vi.mocked(turnNoteFor).mockResolvedValueOnce({
      kind: "turn",
      text: "Say what you are doing.",
    });

    await runTestMachine({
      machine: testMachine.machine,
      chatId: testMachine.chatId,
    });

    expect(prompts[0]?.at(-1)).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "Say what you are doing.",
            "type": "text",
          },
        ],
        "providerOptions": {
          "instrument": {
            "transient": true,
          },
        },
        "role": "user",
      }
    `);
    const stored = await ChatReads.history({
      chatId: testMachine.chatId,
      sessionId,
    });
    expect(
      stored
        ._unsafeUnwrap()
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "data-requestNote")
        .map((part) => part.data),
    ).toEqual([{ kind: "turn", text: "Say what you are doing." }]);
  });

  // The step after a reply the output limit cut off is told to carry on
  // from the cut without repeating it, and the call the cut caught
  // mid-input answers that it never ran, so carrying on includes making it.
  it("reads a call the output limit cut off as never run, beside the note to carry on", async () => {
    const testMachine = await createTestMachine({
      chunks: [
        { id: "1", type: "text-start" },
        { delta: "Reading the plan.", id: "1", type: "text-delta" },
        { id: "1", type: "text-end" },
        { id: "2", toolName: "read_file", type: "tool-input-start" },
        { delta: '{"filePath": "./pl', id: "2", type: "tool-input-delta" },
      ],
      finishReason: "length",
    });

    await runTestMachine(testMachine);
    await runTestMachine(testMachine);
    expect(prompts[1]?.slice(1)).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "providerOptions": undefined,
              "text": "Reading the plan.",
              "type": "text",
            },
            {
              "input": {
                "filePath": "./pl",
              },
              "providerExecuted": undefined,
              "providerOptions": undefined,
              "toolCallId": "2",
              "toolName": "read_file",
              "type": "tool-call",
            },
          ],
          "providerOptions": undefined,
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "error-text",
                "value": "The output limit cut this call off before its input was complete, so it did not run. Call it again.",
              },
              "providerOptions": undefined,
              "toolCallId": "2",
              "toolName": "read_file",
              "type": "tool-result",
            },
          ],
          "providerOptions": undefined,
          "role": "tool",
        },
        {
          "content": [
            {
              "text": "
      <instrument-system-note>
      Your last reply was cut off at the output limit, mid-word. Carry on from exactly where it stops, without repeating what is already there and without starting over. Write less at a time.
      </instrument-system-note>",
              "type": "text",
            },
          ],
          "providerOptions": {
            "instrument": {
              "transient": true,
            },
          },
          "role": "user",
        },
      ]
    `);
  });

  it("searches on xAI's side for a Grok account, keeping each cited page once", async () => {
    const testMachine = await createTestMachine({
      chunks: [
        // A search step xAI names for itself, which no list here knows.
        {
          id: "xk_1",
          toolName: "x_keyword_search",
          type: "tool-input-start",
        },
        { id: "xk_1", type: "tool-input-end" },
        {
          input: "{}",
          providerExecuted: true,
          toolCallId: "xk_1",
          toolName: "x_keyword_search",
          type: "tool-call",
        },
        { id: "ws_1", toolName: "web_search", type: "tool-input-start" },
        { delta: "{}", id: "ws_1", type: "tool-input-delta" },
        { id: "ws_1", type: "tool-input-end" },
        {
          input: "{}",
          providerExecuted: true,
          toolCallId: "ws_1",
          toolName: "web_search",
          type: "tool-call",
        },
        {
          result: {},
          toolCallId: "ws_1",
          toolName: "web_search",
          type: "tool-result",
        },
        ...["s1", "s2"].map((id) => ({
          id,
          sourceType: "url" as const,
          title: "A post",
          type: "source" as const,
          url: "https://x.com/i/status/1",
        })),
        { id: "t", type: "text-start" },
        { delta: "Found it.", id: "t", type: "text-delta" },
        { id: "t", type: "text-end" },
      ],
      modelProvider: "grok-account",
    });
    const { messages } = await runTestMachine(testMachine);

    expect(
      testMachine.mockLanguageModel.doStreamCalls[0]?.tools
        ?.filter((tool) => tool.type === "provider")
        .map((tool) => tool.name),
    ).toEqual(["web_search", "x_search"]);
    expect(
      messages
        .at(-1)
        ?.parts.map((part) =>
          part.type === "source-url" ? `${part.type} ${part.url}` : part.type,
        ),
    ).toMatchInlineSnapshot(`
      [
        "step-start",
        "source-url https://x.com/i/status/1",
        "text",
      ]
    `);
  });

  it("refuses a Grok model's call to a tool that does not exist, rather than taking it for a search", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "made_1", toolName: "made_up", type: "tool-input-start" },
        { delta: "{}", id: "made_1", type: "tool-input-delta" },
        { id: "made_1", type: "tool-input-end" },
        {
          input: "{}",
          toolCallId: "made_1",
          toolName: "made_up",
          type: "tool-call",
        },
      ],
      modelProvider: "grok-account",
    });

    expect(
      messages
        .at(-1)
        ?.parts.filter((part) => part.type === "tool-unavailable")
        .map((part) => "state" in part && part.state),
    ).toEqual(["output-error"]);
  });

  describe("media a provider refused", () => {
    // Header, dimensions and end marker in order, pixel data that does not
    // inflate: every local check passes it, and Claude refuses it. The width
    // tells two of them apart.
    function poisonedPng(width: number) {
      const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.byteLength);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(body));
        return Buffer.concat([length, body, crc]);
      };
      const header = Buffer.alloc(13);
      header.writeUInt32BE(width, 0);
      header.writeUInt32BE(64, 4);
      header[8] = 8;
      header[9] = 2;
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", Buffer.alloc(500, 0xab)),
        chunk("IEND", Buffer.alloc(0)),
      ]).toString("base64");
    }

    const digestOf = (image: string) =>
      mediaDigest(Buffer.from(image, "base64"));

    // As Claude Code reports Anthropic's refusal.
    function claudeRefusal() {
      const message =
        "API Error: an image in the conversation could not be processed and was removed. Re-read the file with a different approach if you still need it.";
      return new APICallError({
        isRetryable: false,
        message,
        requestBodyValues: {},
        responseBody: JSON.stringify({
          error: { message, type: "invalid_request_error" },
        }),
        statusCode: 400,
        url: "claude-account://",
      });
    }

    // A 400 whose wording the classifier does not know.
    function unnamedRefusal() {
      return new APICallError({
        message: "Bad Request",
        requestBodyValues: {},
        responseBody: JSON.stringify({
          error: {
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
          },
        }),
        statusCode: 400,
        url: "https://example.com",
      });
    }

    /**
     * A chat the user opened, and a reply per image that read it with
     * `read_file`, each finished on `modelId`: the newest image is in the
     * result no accepted request carried yet.
     */
    async function seedReads({
      chatId,
      images,
      modelId = "mock-model-id",
    }: {
      chatId: ChatId;
      images: string[];
      modelId?: string;
    }) {
      const userMessageId = StoreId.newMessageId();
      await ChatWrites.saveMessage(
        {
          id: userMessageId,
          metadata: { createdAt: mockDate, sessionId },
          role: "user",
        },
        chatId,
      );
      await saveParts(
        [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId: userMessageId,
              sessionId,
            },
            state: "done",
            text: "What do these labels say?",
            type: "text",
          },
        ],
        chatId,
      );
      for (const [index, image] of images.entries()) {
        const assistantMessageId = StoreId.newMessageId();
        await ChatWrites.saveMessage(
          {
            id: assistantMessageId,
            metadata: {
              createdAt: mockDate,
              finishedAt: mockDate,
              modelId,
              providerId: "mock-provider",
              sessionId,
              usage: mockTotalUsage,
              finishReason: "tool-calls",
            },
            role: "assistant",
          },
          chatId,
        );
        await saveParts(
          [
            SessionMessagePart.CoercedSchema.parse({
              input: { filePath: `label-${index}.png` },
              metadata: {
                createdAt: mockDate,
                endedAt: mockDate,
                id: StoreId.newPartId(),
                messageId: assistantMessageId,
                sessionId,
              },
              output: {
                base64Data: image,
                filePath: `label-${index}.png`,
                height: 64,
                mimeType: "image/png",
                modifiedAt: 0,
                state: "image",
                width: 64,
              },
              state: "output-available",
              toolCallId: `${index + 1}`,
              type: "tool-read_file",
            }),
          ],
          chatId,
        );
      }
    }

    /** A request per answer, refused where the answer is an error. */
    async function chatAnswering(answers: (Error | "accept")[]) {
      const sent: string[] = [];
      const testMachine = await createTestMachine({
        beforeStream: (prompt) => {
          const answer = answers[sent.length];
          sent.push(JSON.stringify(prompt));
          if (answer instanceof Error) {
            throw answer;
          }
          return Promise.resolve();
        },
        chunks: [
          { id: "1", type: "text-start" },
          { delta: "Done.", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
        modelFeatures: ["inputImage", "inputText", "outputText", "tools"],
      });
      const step = async () => {
        const { messages } = await runTestMachine(testMachine);
        const reply = messages.at(-1);
        if (reply?.role !== "assistant") {
          throw new Error("Expected a reply");
        }
        return reply;
      };
      return { sent, step, testMachine };
    }

    it("leaves out an image the provider refused, from the next request on", async () => {
      const poisoned = poisonedPng(64);
      const chat = await chatAnswering([claudeRefusal(), "accept", "accept"]);
      await seedReads({
        chatId: chat.testMachine.chatId,
        images: [poisoned],
      });

      const refusal = await chat.step();
      // The refused request blamed the image, by the bytes it sent.
      expect(refusal.metadata.refusedMedia).toEqual([digestOf(poisoned)]);
      expect(getErrorAction(refusal)).toEqual({ type: "retry" });

      // The retry, sent without it, is accepted, which confirms the blame, so
      // the image stays out of the turn after too.
      for (const _ of [1, 2]) {
        expect((await chat.step()).metadata.error).toBeUndefined();
      }
      for (const prompt of chat.sent.slice(1)) {
        expect(prompt).not.toContain(poisoned);
        expect(prompt).toContain(
          "image/png omitted: the model's provider refused it",
        );
      }
    });

    it("blames only the image the request newly carried, and stops when refused again", async () => {
      const older = poisonedPng(64);
      const newer = poisonedPng(65);
      const chat = await chatAnswering([
        claudeRefusal(),
        claudeRefusal(),
        "accept",
      ]);
      await seedReads({
        chatId: chat.testMachine.chatId,
        images: [older, newer],
      });

      const first = await chat.step();
      expect(first.metadata.refusedMedia).toEqual([digestOf(newer)]);

      // The retry leaves out only the newer image, and its refusal names
      // nothing new, so the turn stops.
      const second = await chat.step();
      expect(chat.sent[1]).toContain(older);
      expect(chat.sent[1]).not.toContain(newer);
      expect(second.metadata.refusedMedia).toBeUndefined();
      expect(getErrorAction(second)).toEqual({ type: "stop" });

      // The guess was never confirmed, so the next turn sends both again.
      await chat.step();
      expect(chat.sent[2]).toContain(older);
      expect(chat.sent[2]).toContain(newer);
    });

    it("blames nothing for a limit on the request's images as a whole", async () => {
      const chat = await chatAnswering([
        new APICallError({
          message:
            "messages.12.content.0.image.source.base64.data: At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels",
          requestBodyValues: {},
          statusCode: 400,
          url: "https://api.anthropic.com/v1/messages",
        }),
      ]);
      await seedReads({
        chatId: chat.testMachine.chatId,
        images: [poisonedPng(64)],
      });

      const refusal = await chat.step();
      expect(refusal.metadata.refusedMedia).toBeUndefined();
      expect(getErrorAction(refusal)).toEqual({ type: "stop" });
    });

    it("retries a 400 nothing names once without the image it newly carried", async () => {
      const poisoned = poisonedPng(64);
      const chat = await chatAnswering([unnamedRefusal(), "accept", "accept"]);
      await seedReads({
        chatId: chat.testMachine.chatId,
        images: [poisonedPng(65), poisoned],
      });

      const refusal = await chat.step();
      expect(refusal.metadata.refusedMedia).toEqual([digestOf(poisoned)]);
      expect(getErrorAction(refusal)).toEqual({ type: "retry" });

      await chat.step();
      await chat.step();
      for (const prompt of chat.sent.slice(1)) {
        expect(prompt).not.toContain(poisoned);
      }
    });

    it.each([
      {
        // The newest reply finished with nothing after it to blame.
        images: [poisonedPng(64)],
        modelId: "mock-model-id",
        name: "with no image new since the last reply",
        withTextAfter: true,
      },
      {
        images: [poisonedPng(64)],
        modelId: "another-model-id",
        name: "on the first request after a model switch",
        withTextAfter: false,
      },
    ])(
      "blames nothing for a 400 nothing names $name",
      async ({ images, modelId, withTextAfter }) => {
        const chat = await chatAnswering([unnamedRefusal()]);
        await seedReads({ chatId: chat.testMachine.chatId, images, modelId });
        if (withTextAfter) {
          const replyId = StoreId.newMessageId();
          await ChatWrites.saveMessage(
            {
              id: replyId,
              metadata: {
                createdAt: mockDate,
                finishedAt: mockDate,
                modelId,
                providerId: "mock-provider",
                sessionId,
                usage: mockTotalUsage,
                finishReason: "stop",
              },
              role: "assistant",
            },
            chat.testMachine.chatId,
          );
          await saveParts(
            [
              {
                metadata: {
                  createdAt: mockDate,
                  id: StoreId.newPartId(),
                  messageId: replyId,
                  sessionId,
                },
                state: "done",
                text: "It says hello.",
                type: "text",
              },
            ],
            chat.testMachine.chatId,
          );
        }

        const refusal = await chat.step();
        expect(refusal.metadata.refusedMedia).toBeUndefined();
      },
    );
  });

  it("holds a reply still arriving in the turn's memory, and records none of it", async () => {
    const input = JSON.stringify({
      activity: "Reading the list",
      command: "cat list.md",
    });
    await withRecordsInPlace(async (records, dir) => {
      const held: Promise<ChatRead>[] = [];
      const testMachine = await createTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          { delta: "Looking.", id: "1", type: "text-delta" },
          { id: "call-1", toolName: "bash", type: "tool-input-start" },
          { delta: input, id: "call-1", type: "tool-input-delta" },
          { id: "1", type: "text-end" },
          {
            input,
            toolCallId: "call-1",
            toolName: "bash",
            type: "tool-call",
          },
          {
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: mockUsage,
          },
        ],
        // Read as each chunk arrives, so what the turn held along the way is
        // what is checked, not only where it ended.
        onChunkReceived: () => {
          held.push(records.read(testMachine.chatId));
        },
      });

      await runTestMachine(testMachine);
      // The turn has ended, so it holds nothing.
      expect((await records.read(testMachine.chatId)).live.size).toBe(0);
      // Every append the turn queued, landed: a read of the file is a read
      // of the whole turn.

      const arriving = (await Promise.all(held)).flatMap((read) =>
        liveView(read, sessionId).flatMap((message) => message.parts),
      );
      expect(
        arriving.flatMap((part) => (part.type === "text" ? [part.text] : [])),
      ).toContain("Looking.");
      expect(
        arriving.some(
          (part) => isToolPart(part) && part.state === "input-streaming",
        ),
      ).toBe(true);
      const log = await fs.readFile(
        path.join(dir, logFileName(sessionId, records.device)),
        "utf8",
      );
      expect(log).not.toContain("input-streaming");
      expect(log).not.toContain('"state":"streaming"');
      expect(log).toContain('"state":"input-available"');
      expect(log).toContain("Looking.");
    });
  });
});
