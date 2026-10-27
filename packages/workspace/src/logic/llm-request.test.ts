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
import { isToolPart } from "../lib/is-tool-part";
import { type ChatRead } from "../lib/records/chat-records";
import { logFileName } from "../lib/records/file-names";
import { liveView } from "../lib/records/views";
import { turnNoteFor } from "../lib/turn-note";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../lib/llm-token-limits";
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
    modelProvider,
    onChunkReceived,
    provider = OUR_PROVIDER_CONFIG.type,
  }: {
    beforeStream?: () => Promise<void>;
    catalog?: AIGatewayModel.Type[];
    chunks: LanguageModelV4StreamPart[];
    finishReason?: "length" | "stop";
    getMessages?: () => Promise<SessionMessage.ContextWithParts[]>;
    /** The connection the chat's model is on, where it differs from `provider`'s. */
    modelProvider?: AIProviderType;
    onChunkReceived?: () => void;
    provider?: AIProviderType;
  }) {
    const mockLanguageModel = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        if (beforeStream) {
          await beforeStream();
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

  function messagesToSnapshot(messages: SessionMessage.Type[]) {
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
      // The current shape reads as such, so bumping it leaves these alone.
      if (
        "contextVersion" in message.metadata &&
        message.metadata.contextVersion === SESSION_CONTEXT_VERSION
      ) {
        return {
          ...message,
          metadata: { ...message.metadata, contextVersion: "current" },
        };
      }
      return message;
    });
  }

  it("should handle text streaming", async () => {
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
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
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

  it("should handle tool streaming", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
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
        {
          finishReason: { raw: "stop", unified: "stop" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000Z98888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.6666666666666667,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000Z98888888888888889",
                "messageId": "msg_00000000Z98888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "input": {
                "filePath": "test-file.txt",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "id": "prt_00000000Z9888888888888888A",
                "messageId": "msg_00000000Z98888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "input-available",
              "toolCallId": "test-call-1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle reasoning events", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        { id: "1", type: "reasoning-start" },
        {
          delta: "First, I need to consider",
          id: "1",
          type: "reasoning-delta",
        },
        { delta: " the implications", id: "1", type: "reasoning-delta" },
        { delta: " of this approach", id: "1", type: "reasoning-delta" },
        { delta: " and then proceed", id: "1", type: "reasoning-delta" },
        { id: "1", type: "reasoning-end" },
        {
          finishReason: { raw: "stop", unified: "stop" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZA8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.4285714285714286,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZA8888888888888889",
                "messageId": "msg_00000000ZA8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:11.000Z,
                "id": "prt_00000000ZA888888888888888A",
                "messageId": "msg_00000000ZA8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "done",
              "text": "First, I need to consider the implications of this approach and then proceed",
              "type": "reasoning",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle source events", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "test-source-id",
          providerMetadata: {
            testProvider: {
              test: "test",
            },
          },
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
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZB8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZB8888888888888889",
                "messageId": "msg_00000000ZB8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "id": "prt_00000000ZB888888888888888A",
                "messageId": "msg_00000000ZB8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "sourceId": "test-source-id",
              "title": "Test Source",
              "type": "source-url",
              "url": "https://example.com/test-source",
            },
            {
              "filename": "test-document.pdf",
              "mediaType": "application/pdf",
              "metadata": {
                "createdAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZB888888888888888B",
                "messageId": "msg_00000000ZB8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "sourceId": "test-doc-id",
              "title": "Test Document",
              "type": "source-document",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle incorrect input key name for tool call", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ invalid: "params" }),
          toolCallId: "1",
          toolName: "read_file",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZC8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZC8888888888888889",
                "messageId": "msg_00000000ZC8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Invalid input for tool read_file: Type validation failed: Value: {"invalid":"params"}.
      Error message: [
        {
          "expected": "string",
          "code": "invalid_type",
          "path": [
            "filePath"
          ],
          "message": "Invalid input: expected string, received undefined"
        }
      ]",
              "input": {
                "invalid": "params",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZC888888888888888A",
                "messageId": "msg_00000000ZC8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle invalid json for tool call", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: "invalid json",
          toolCallId: "1",
          toolName: "read_file",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZD8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZD8888888888888889",
                "messageId": "msg_00000000ZD8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Invalid input for tool read_file: JSON parsing failed: Text: invalid json.
      Error message: Unexpected token 'i', "invalid json" is not valid JSON",
              "input": "invalid json",
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZD888888888888888A",
                "messageId": "msg_00000000ZD8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("tells the model a call was cut off rather than that its input was invalid", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: '{"filePath": "./lease',
          toolCallId: "1",
          toolName: "read_file",
          type: "tool-call",
        },
      ],
      finishReason: "length",
    });
    const toolParts = messages
      .flatMap((message) => ("parts" in message ? message.parts : []))
      .filter(isToolPart)
      .map((part) => ({ errorText: part.errorText, state: part.state }));
    expect(toolParts).toMatchInlineSnapshot(`
      [
        {
          "errorText": "The output limit cut this call off before its input was complete, so it did not run. Call it again.",
          "state": "output-error",
        },
      ]
    `);
  });

  it("settles a call the output limit stopped mid-input, rather than leaving it arriving", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          delta: '{"filePath": "./le',
          id: "1",
          type: "tool-input-delta",
        },
      ],
      finishReason: "length",
    });
    const toolParts = messages
      .flatMap((message) => ("parts" in message ? message.parts : []))
      .filter(isToolPart)
      .map((part) => ({ errorText: part.errorText, state: part.state }));
    expect(toolParts).toMatchInlineSnapshot(`
      [
        {
          "errorText": "The output limit cut this call off before its input was complete, so it did not run. Call it again.",
          "state": "output-error",
        },
      ]
    `);
  });

  it("should handle incorrect input key name for tool call without start part", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          input: JSON.stringify({ invalid: "params" }),
          toolCallId: "1",
          toolName: "read_file",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZG8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZG8888888888888889",
                "messageId": "msg_00000000ZG8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Invalid input for tool read_file: Type validation failed: Value: {"invalid":"params"}.
      Error message: [
        {
          "expected": "string",
          "code": "invalid_type",
          "path": [
            "filePath"
          ],
          "message": "Invalid input: expected string, received undefined"
        }
      ]",
              "input": {
                "invalid": "params",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZG888888888888888A",
                "messageId": "msg_00000000ZG8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle non-existent tool name", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "non_existent_tool",
          type: "tool-input-start",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZH8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 2,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZH8888888888888889",
                "messageId": "msg_00000000ZH8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "This action was cut off before it could run.",
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:14.000Z,
                "id": "prt_00000000ZH888888888888888A",
                "messageId": "msg_00000000ZH8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-unavailable",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle non-existent tool name with call part", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "non_existent_tool",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ unknown: "params" }),
          toolCallId: "1",
          toolName: "non_existent_tool",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZJ8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZJ8888888888888889",
                "messageId": "msg_00000000ZJ8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Model tried to call unavailable tool 'non_existent_tool'. Available tools: ask_permission, bash, choose, connect_app, edit_file, generate_image, load_skill, offer_feedback, read_file, unavailable, web_fetch, web_search, write_file.",
              "input": {
                "unknown": "params",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZJ888888888888888A",
                "messageId": "msg_00000000ZJ8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-unavailable",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle non-existent tool name with start part", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          id: "1",
          toolName: "read_file",
          type: "tool-input-start",
        },
        {
          input: JSON.stringify({ filePath: "test.txt" }),
          toolCallId: "1",
          toolName: "non_existent_tool",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZK8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZK8888888888888889",
                "messageId": "msg_00000000ZK8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Model tried to call unavailable tool 'non_existent_tool'. Available tools: ask_permission, bash, choose, connect_app, edit_file, generate_image, load_skill, offer_feedback, read_file, unavailable, web_fetch, web_search, write_file.",
              "input": {
                "filePath": "test.txt",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZK888888888888888A",
                "messageId": "msg_00000000ZK8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-unavailable",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle non-existent tool name without start part", async () => {
    const { messages } = await createAndRunTestMachine({
      chunks: [
        {
          input: JSON.stringify({ filePath: "test.txt" }),
          toolCallId: "1",
          toolName: "non_existent_tool",
          type: "tool-call",
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZM8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.25,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZM8888888888888889",
                "messageId": "msg_00000000ZM8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "errorText": "Model tried to call unavailable tool 'non_existent_tool'. Available tools: ask_permission, bash, choose, connect_app, edit_file, generate_image, load_skill, offer_feedback, read_file, unavailable, web_fetch, web_search, write_file.",
              "input": {
                "filePath": "test.txt",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:12.000Z,
                "id": "prt_00000000ZM888888888888888A",
                "messageId": "msg_00000000ZM8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "output-error",
              "toolCallId": "1",
              "type": "tool-unavailable",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  it("should handle call provider metadata on tool part", async () => {
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
            anthropic: {
              cacheCreationInputTokens: 100,
              cacheReadInputTokens: 50,
            },
          },
          toolCallId: "test-call-1",
          toolName: "read_file",
          type: "tool-call",
        },
        {
          finishReason: { raw: "stop", unified: "stop" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZN8888888888888888",
          "metadata": {
            "completionTokensPerSecond": 1.6666666666666667,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZN8888888888888889",
                "messageId": "msg_00000000ZN8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "callProviderMetadata": {
                "anthropic": {
                  "cacheCreationInputTokens": 100,
                  "cacheReadInputTokens": 50,
                },
              },
              "input": {
                "filePath": "test-file.txt",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "id": "prt_00000000ZN888888888888888A",
                "messageId": "msg_00000000ZN8888888888888888",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "input-available",
              "toolCallId": "test-call-1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  describe("stream errors", () => {
    it("should handle api call errors", async () => {
      const mockError = new APICallError({
        cause: new Error("API call failed"),
        message: "Failed to process error response",
        requestBodyValues: {},
        responseHeaders: {},
        statusCode: 500,
        url: "https://api.openai.com/v1/chat/completions",
      });

      const { messages } = await createAndRunTestMachine({
        beforeStream: () => {
          throw mockError;
        },
        chunks: [],
      });
      expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
        [
          {
            "id": "msg_00000000018888888888888889",
            "metadata": {
              "agentName": "main",
              "contextVersion": "current",
              "createdAt": 2013-08-31T12:00:00.000Z,
              "realRole": "assistant",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:00.000Z,
                  "id": "prt_0000000001888888888888888A",
                  "messageId": "msg_00000000018888888888888889",
                  "sessionId": "ses_00000000018888888888888888",
                },
                "text": "You are a helpful assistant.",
                "type": "text",
              },
            ],
            "role": "session-context",
          },
          {
            "id": "msg_00000000ZP8888888888888888",
            "metadata": {
              "error": {
                "classification": "transient",
                "kind": "api-call",
                "message": "Failed to process error response",
                "name": "AI_APICallError",
                "statusCode": 500,
                "url": "https://api.openai.com/v1/chat/completions",
              },
              "finishReason": "unknown",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:07.000Z,
                  "id": "prt_00000000ZP8888888888888889",
                  "messageId": "msg_00000000ZP8888888888888888",
                  "sessionId": "ses_00000000018888888888888888",
                  "stepCount": 1,
                },
                "type": "step-start",
              },
            ],
            "role": "assistant",
          },
        ]
      `);
    });

    it("should handle aborted errors", async () => {
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
      expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
        [
          {
            "id": "msg_00000000018888888888888889",
            "metadata": {
              "agentName": "main",
              "contextVersion": "current",
              "createdAt": 2013-08-31T12:00:00.000Z,
              "realRole": "assistant",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:00.000Z,
                  "id": "prt_0000000001888888888888888A",
                  "messageId": "msg_00000000018888888888888889",
                  "sessionId": "ses_00000000018888888888888888",
                },
                "text": "You are a helpful assistant.",
                "type": "text",
              },
            ],
            "role": "session-context",
          },
          {
            "id": "msg_00000000ZQ8888888888888888",
            "metadata": {
              "error": {
                "kind": "aborted",
                "message": "Aborted",
                "reason": "manual",
              },
              "finishReason": "aborted",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:07.000Z,
                  "id": "prt_00000000ZQ8888888888888889",
                  "messageId": "msg_00000000ZQ8888888888888888",
                  "sessionId": "ses_00000000018888888888888888",
                  "stepCount": 1,
                },
                "type": "step-start",
              },
            ],
            "role": "assistant",
          },
        ]
      `);
      // Stripped from the snapshot above, and the point of this assertion: a
      // turn stopped part way through spent the time it spent, and reporting
      // nothing for it reads as a turn that was instant.
      const aborted = messages.at(-1);
      expect(
        aborted?.role === "assistant" ? aborted.metadata.msToFinish : undefined,
      ).toMatchInlineSnapshot(`4000`);
    });

    it("should handle unknown errors", async () => {
      const { messages } = await createAndRunTestMachine({
        beforeStream: () => {
          throw new Error("Unknown error");
        },
        chunks: [],
      });
      expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
        [
          {
            "id": "msg_00000000018888888888888889",
            "metadata": {
              "agentName": "main",
              "contextVersion": "current",
              "createdAt": 2013-08-31T12:00:00.000Z,
              "realRole": "assistant",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:00.000Z,
                  "id": "prt_0000000001888888888888888A",
                  "messageId": "msg_00000000018888888888888889",
                  "sessionId": "ses_00000000018888888888888888",
                },
                "text": "You are a helpful assistant.",
                "type": "text",
              },
            ],
            "role": "session-context",
          },
          {
            "id": "msg_00000000ZR8888888888888888",
            "metadata": {
              "error": {
                "classification": "unknown",
                "kind": "unknown",
                "message": "Unknown error",
              },
              "finishReason": "unknown",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:07.000Z,
                  "id": "prt_00000000ZR8888888888888889",
                  "messageId": "msg_00000000ZR8888888888888888",
                  "sessionId": "ses_00000000018888888888888888",
                  "stepCount": 1,
                },
                "type": "step-start",
              },
            ],
            "role": "assistant",
          },
        ]
      `);
    });

    it("should name a throttle reported inside a 200 stream", async () => {
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

      const assistantMessage = messages.findLast(
        (message) => message.role === "assistant",
      );
      expect(assistantMessage?.metadata.error).toMatchInlineSnapshot(`
        {
          "classification": "rate-limit",
          "kind": "unknown",
          "message": "openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
        }
      `);
    });
  });

  describe("prompt messages", () => {
    const userMessageId = StoreId.newMessageId();
    const assistantMessageId = StoreId.newMessageId();
    const mockAssistantMessageMetadata = {
      createdAt: mockDate,
      finishReason: "stop" as const,
      modelId: "mock-model-id",
      providerId: "mock-provider",
      sessionId,
      usage: mockTotalUsage,
    };
    const readFilePart: SessionMessagePart.Type = {
      input: {
        filePath: "./test-file.txt",
      },
      metadata: {
        createdAt: mockDate,
        endedAt: mockDate,
        id: StoreId.newPartId(),
        messageId: assistantMessageId,
        sessionId,
      },
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
    };

    async function setupPromptMessagesTest() {
      const testMachine = await createTestMachine({
        chunks: [],
      });

      await ChatWrites.saveMessage(
        {
          id: userMessageId,
          metadata: {
            createdAt: mockDate,
            sessionId,
          },
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
              messageId: userMessageId,
              sessionId,
            },
            state: "done",
            text: "Do something",
            type: "text",
          },
        ],
        testMachine.chatId,
      );

      await ChatWrites.saveMessage(
        {
          id: assistantMessageId,
          metadata: mockAssistantMessageMetadata,
          role: "assistant",
        },
        testMachine.chatId,
      );

      return testMachine;
    }

    it("handles user and assistant messages", async () => {
      const testMachine = await setupPromptMessagesTest();
      const actor = createActor(testMachine.machine);
      actor.start();
      await waitFor(actor, (state) => state.status === "done");
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
          ],
        ]
      `);
    });

    it("handles one tool call", async () => {
      const testMachine = await setupPromptMessagesTest();
      await ChatWrites.savePart(
        SessionMessagePart.coerce(readFilePart),
        testMachine.chatId,
      );

      await runTestMachine({
        machine: testMachine.machine,
        chatId: testMachine.chatId,
      });
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
            {
              "content": [
                {
                  "input": {
                    "filePath": "./test-file.txt",
                  },
                  "providerExecuted": undefined,
                  "providerOptions": undefined,
                  "toolCallId": "1",
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
                    "type": "text",
                    "value": "<path>./test-file.txt</path>
        <content>
           1→test-file.txt content
        </content>",
                  },
                  "providerOptions": undefined,
                  "toolCallId": "1",
                  "toolName": "read_file",
                  "type": "tool-result",
                },
              ],
              "providerOptions": undefined,
              "role": "tool",
            },
          ],
        ]
      `);
    });

    it("handles two tool calls", async () => {
      const testMachine = await setupPromptMessagesTest();
      await saveParts(
        [
          readFilePart,
          {
            input: {
              content: "new content",
              filePath: "./output.txt",
            },
            metadata: {
              createdAt: mockDate,
              endedAt: mockDate,
              id: StoreId.newPartId(),
              messageId: assistantMessageId,
              sessionId,
            },
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
        testMachine.chatId,
      );

      await runTestMachine(testMachine);
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
            {
              "content": [
                {
                  "input": {
                    "filePath": "./test-file.txt",
                  },
                  "providerExecuted": undefined,
                  "providerOptions": undefined,
                  "toolCallId": "1",
                  "toolName": "read_file",
                  "type": "tool-call",
                },
                {
                  "input": {
                    "content": "new content",
                    "filePath": "./output.txt",
                  },
                  "providerExecuted": undefined,
                  "providerOptions": undefined,
                  "toolCallId": "2",
                  "toolName": "write_file",
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
                    "type": "text",
                    "value": "<path>./test-file.txt</path>
        <content>
           1→test-file.txt content
        </content>",
                  },
                  "providerOptions": undefined,
                  "toolCallId": "1",
                  "toolName": "read_file",
                  "type": "tool-result",
                },
                {
                  "output": {
                    "type": "text",
                    "value": "Successfully wrote new file ./output.txt",
                  },
                  "providerOptions": undefined,
                  "toolCallId": "2",
                  "toolName": "write_file",
                  "type": "tool-result",
                },
              ],
              "providerOptions": undefined,
              "role": "tool",
            },
          ],
        ]
      `);
    });

    it("handles tool call with diagnostics reminder", async () => {
      const testMachine = await setupPromptMessagesTest();
      await saveParts(
        [
          {
            input: {
              content: "console.log('hi');",
              filePath: "./foo.ts",
            },
            metadata: {
              createdAt: mockDate,
              endedAt: mockDate,
              id: StoreId.newPartId(),
              messageId: assistantMessageId,
              sessionId,
            },
            output: {
              content: "console.log('hi');",
              filePath: RelativePathSchema.parse("./foo.ts"),
              isNewFile: true,
              modifiedAt: 1_234_567_890,
            },
            state: "output-available",
            toolCallId: StoreId.ToolCallSchema.parse("2"),
            type: "tool-write_file",
          },
        ],
        testMachine.chatId,
      );

      await runTestMachine(testMachine);
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
            {
              "content": [
                {
                  "input": {
                    "content": "console.log('hi');",
                    "filePath": "./foo.ts",
                  },
                  "providerExecuted": undefined,
                  "providerOptions": undefined,
                  "toolCallId": "2",
                  "toolName": "write_file",
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
                    "type": "text",
                    "value": "Successfully wrote new file ./foo.ts",
                  },
                  "providerOptions": undefined,
                  "toolCallId": "2",
                  "toolName": "write_file",
                  "type": "tool-result",
                },
              ],
              "providerOptions": undefined,
              "role": "tool",
            },
          ],
        ]
      `);
    });

    it("handles tool call errors", async () => {
      const testMachine = await setupPromptMessagesTest();
      await saveParts(
        [
          {
            errorText:
              "File is too large (300000 bytes). Maximum size is 256000 bytes",
            input: { filePath: "./test-file.txt" },
            metadata: {
              createdAt: mockDate,
              endedAt: mockDate,
              id: StoreId.newPartId(),
              messageId: assistantMessageId,
              sessionId,
            },
            state: "output-error",
            toolCallId: StoreId.ToolCallSchema.parse("1"),
            type: "tool-read_file",
          },
        ],
        testMachine.chatId,
      );

      await runTestMachine(testMachine);
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
            {
              "content": [
                {
                  "input": {
                    "filePath": "./test-file.txt",
                  },
                  "providerExecuted": undefined,
                  "providerOptions": undefined,
                  "toolCallId": "1",
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
                    "value": "File is too large (300000 bytes). Maximum size is 256000 bytes",
                  },
                  "providerOptions": undefined,
                  "toolCallId": "1",
                  "toolName": "read_file",
                  "type": "tool-result",
                },
              ],
              "providerOptions": undefined,
              "role": "tool",
            },
          ],
        ]
      `);
    });

    it("adds cache control to messages for Anthropic models", async () => {
      const testMachine = await createTestMachine({
        chunks: [],
        provider: "anthropic",
      });

      await ChatWrites.saveMessage(
        {
          id: userMessageId,
          metadata: {
            createdAt: mockDate,
            sessionId,
          },
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
              messageId: userMessageId,
              sessionId,
            },
            state: "done",
            text: "Do something",
            type: "text",
          },
        ],
        testMachine.chatId,
      );

      await ChatWrites.saveMessage(
        {
          id: assistantMessageId,
          metadata: mockAssistantMessageMetadata,
          role: "assistant",
        },
        testMachine.chatId,
      );

      const secondMessageId = StoreId.newMessageId();
      await ChatWrites.saveMessage(
        {
          id: secondMessageId,
          metadata: mockAssistantMessageMetadata,
          role: "assistant",
        },
        testMachine.chatId,
      );
      await saveParts(
        [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId: secondMessageId,
              sessionId,
            },
            state: "done",
            text: "What would you like to do?",
            type: "text",
          },
        ],
        testMachine.chatId,
      );
      const thirdMessageId = StoreId.newMessageId();
      await ChatWrites.saveMessage(
        {
          id: thirdMessageId,
          metadata: mockAssistantMessageMetadata,
          role: "assistant",
        },
        testMachine.chatId,
      );
      await saveParts(
        [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId: thirdMessageId,
              sessionId,
            },
            state: "done",
            text: "I'm ready to help you with that task.",
            type: "text",
          },
        ],
        testMachine.chatId,
      );

      await runTestMachine(testMachine);
      // Test that there are a maximum of 4 cache control markers
      const promptMessages = prompts[0];
      const anthropicCacheControlCount = promptMessages?.filter((message) => {
        return (
          message.providerOptions?.anthropic &&
          "cacheControl" in message.providerOptions.anthropic
        );
      }).length;
      expect(anthropicCacheControlCount).toBeLessThanOrEqual(4);
      expect(prompts).toMatchInlineSnapshot(`
        [
          [
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "You are a helpful assistant.",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "Do something",
                  "type": "text",
                },
              ],
              "providerOptions": undefined,
              "role": "user",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "What would you like to do?",
                  "type": "text",
                },
              ],
              "providerOptions": {
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
              },
              "role": "assistant",
            },
            {
              "content": [
                {
                  "providerOptions": undefined,
                  "text": "I'm ready to help you with that task.",
                  "type": "text",
                },
              ],
              "providerOptions": {
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
              },
              "role": "assistant",
            },
          ],
        ]
      `);
    });

    // The session context is the session's immutable baseline: however long ago
    // it was written, it is reused byte for byte rather than rebuilt, so the
    // prefix every later request shares with the cached one does not move.
    it("reuses session context of any age", async () => {
      await setupPromptMessagesTest();
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
      const contextMessages = messages.filter(
        (message) => message.role === "session-context",
      );
      expect(
        contextMessages.map((message) => message.id),
        "The stored context message should be the only one, with its id intact",
      ).toEqual([staleMessageId]);
      expect(
        JSON.stringify(contextMessages),
        "The stored context text should reach the model unchanged",
      ).toContain(oldText);
      expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
        [
          {
            "id": "msg_00000000ZX8888888888888889",
            "metadata": {
              "agentName": "main",
              "contextVersion": "current",
              "createdAt": 2013-08-31T10:00:00.000Z,
              "realRole": "user",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T10:00:00.000Z,
                  "id": "prt_00000000ZX888888888888888A",
                  "messageId": "msg_00000000ZX8888888888888889",
                  "sessionId": "ses_00000000018888888888888888",
                },
                "text": "You are an assistant from two hours ago.",
                "type": "text",
              },
            ],
            "role": "session-context",
          },
          {
            "id": "msg_00000000ZX888888888888888B",
            "metadata": {
              "completionTokensPerSecond": 1.4285714285714286,
              "finishReason": "stop",
              "sessionId": "ses_00000000018888888888888888",
            },
            "parts": [
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:12.000Z,
                  "id": "prt_00000000ZX888888888888888C",
                  "messageId": "msg_00000000ZX888888888888888B",
                  "sessionId": "ses_00000000018888888888888888",
                  "stepCount": 1,
                },
                "type": "step-start",
              },
              {
                "metadata": {
                  "createdAt": 2013-08-31T12:00:15.000Z,
                  "endedAt": 2013-08-31T12:00:16.000Z,
                  "id": "prt_00000000ZX888888888888888D",
                  "messageId": "msg_00000000ZX888888888888888B",
                  "sessionId": "ses_00000000018888888888888888",
                },
                "state": "done",
                "text": "Response text",
                "type": "text",
              },
            ],
            "role": "assistant",
          },
        ]
      `);
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

  it("should end reasoning where a tool call supersedes it", async () => {
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
        {
          finishReason: { raw: "stop", unified: "stop" },
          type: "finish",
          usage: mockUsage,
        },
      ],
    });
    expect(messagesToSnapshot(messages)).toMatchInlineSnapshot(`
      [
        {
          "id": "msg_00000000018888888888888889",
          "metadata": {
            "agentName": "main",
            "contextVersion": "current",
            "createdAt": 2013-08-31T12:00:00.000Z,
            "realRole": "assistant",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:00.000Z,
                "id": "prt_0000000001888888888888888A",
                "messageId": "msg_00000000018888888888888889",
                "sessionId": "ses_00000000018888888888888888",
              },
              "text": "You are a helpful assistant.",
              "type": "text",
            },
          ],
          "role": "session-context",
        },
        {
          "id": "msg_00000000ZX888888888888888H",
          "metadata": {
            "completionTokensPerSecond": 1,
            "finishReason": "stop",
            "sessionId": "ses_00000000018888888888888888",
          },
          "parts": [
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:07.000Z,
                "id": "prt_00000000ZX888888888888888J",
                "messageId": "msg_00000000ZX888888888888888H",
                "sessionId": "ses_00000000018888888888888888",
                "stepCount": 1,
              },
              "type": "step-start",
            },
            {
              "metadata": {
                "createdAt": 2013-08-31T12:00:10.000Z,
                "endedAt": 2013-08-31T12:00:11.000Z,
                "id": "prt_00000000ZX888888888888888K",
                "messageId": "msg_00000000ZX888888888888888H",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "done",
              "text": "I should read the file",
              "type": "reasoning",
            },
            {
              "input": {
                "filePath": "test-file.txt",
              },
              "metadata": {
                "createdAt": 2013-08-31T12:00:13.000Z,
                "id": "prt_00000000ZX888888888888888M",
                "messageId": "msg_00000000ZX888888888888888H",
                "sessionId": "ses_00000000018888888888888888",
              },
              "state": "input-available",
              "toolCallId": "test-call-1",
              "type": "tool-read_file",
            },
          ],
          "role": "assistant",
        },
      ]
    `);
  });

  // The AI SDK seeds its response metadata with the id we sent and overwrites it
  // only when the provider reports one, so an id equal to the request is not
  // evidence that anything named it. Only a difference can have come from the
  // provider, and only a difference is worth storing.
  describe("the model that served the request", () => {
    it("records the served id when the provider names a different model", async () => {
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { modelId: "openai/gpt-5.6-luna", type: "response-metadata" },
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(assistant?.metadata).toMatchObject({
        modelIdServed: "openai/gpt-5.6-luna",
      });
    });

    // Nothing in the mock cache answers to that id, which is the ordinary
    // outcome for a model released between two refreshes of the list. The id
    // stands on its own and everything reading it falls back to showing it.
    it("snapshots the served model's record when the catalog has one", async () => {
      const luna = createMockAIGatewayModel({
        author: "openai",
        canonicalId: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        providerId: "openai/gpt-5.6-luna",
      });
      const { messages } = await createAndRunTestMachine({
        catalog: [luna],
        chunks: [
          { modelId: "openai/gpt-5.6-luna", type: "response-metadata" },
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(assistant?.metadata).toMatchObject({
        aiGatewayModelServed: { name: "GPT-5.6 Luna" },
        modelIdServed: "openai/gpt-5.6-luna",
      });
    });

    it("leaves the served model record absent when the catalog has none", async () => {
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { modelId: "openai/gpt-5.6-luna", type: "response-metadata" },
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(
        assistant && "aiGatewayModelServed" in assistant.metadata
          ? assistant.metadata.aiGatewayModelServed
          : undefined,
      ).toBeUndefined();
    });

    // OpenAI's catalog carries undated aliases and its API answers with the
    // dated build behind one, so without this a direct OpenAI key reported a
    // substitution on every single turn.
    it("records nothing when the provider pins the model we asked for to a build", async () => {
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { modelId: "mock-model-id-2026-01-15", type: "response-metadata" },
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(
        assistant && "modelIdServed" in assistant.metadata
          ? assistant.metadata.modelIdServed
          : undefined,
      ).toBeUndefined();
    });

    it("records nothing when the provider names the model we asked for", async () => {
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { modelId: "mock-model-id", type: "response-metadata" },
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(
        assistant && "modelIdServed" in assistant.metadata
          ? assistant.metadata.modelIdServed
          : undefined,
      ).toBeUndefined();
    });

    // Google reports nothing at all, so its every turn used to claim it had
    // been served the model we asked for.
    it("records nothing when the provider reports no model", async () => {
      const { messages } = await createAndRunTestMachine({
        chunks: [
          { id: "1", type: "text-start" },
          { delta: "Hello", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
        ],
      });

      const assistant = messages.find(
        (message) => message.role === "assistant",
      );
      expect(
        assistant && "modelIdServed" in assistant.metadata
          ? assistant.metadata.modelIdServed
          : undefined,
      ).toBeUndefined();
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
      expect(savePartSpy.mock.calls.length).toBeLessThan(deltas.length / 10);
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

  // Last in the file: it takes ids from the mocked ulid, and every snapshot
  // after it would shift. A Claude account's process compares each request
  // with the last one it saw, and the note is gone by the next step; counted
  // as seen, it reads as an edited message and restarts the process from a
  // replay.
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
    vi.mocked(turnNoteFor).mockResolvedValueOnce("Say what you are doing.");

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

  // After the cases whose snapshots number their ids off the ones before
  // them, and before the one that moves the chat's records.
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
