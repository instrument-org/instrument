import {
  type ImageModelV4,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import {
  type AIGatewayModel,
  type AISDKWebSearchModelResult,
} from "@instrument-org/ai-gateway";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import mockFs from "mock-fs";
import { ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { noop, pick } from "radashi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  type ActorOptions,
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  SimulatedClock,
  waitFor,
} from "xstate";

import { setupAgent } from "../agents/create-agent";
import { instrumentAgent } from "../agents/instrument";
import { type AnyAgent } from "../agents/types";
import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../constants";
import {
  killSessionBackgroundProcesses,
  listBackgroundProcesses,
} from "../lib/background-processes";
import { writeChatFolder } from "../lib/chat-folders/write-chat-folder";
import { openAsks } from "../lib/chat/open-asks";
import * as children from "../lib/chat/children";
import * as bashEnv from "../lib/create-bash-env";
import * as recordFolders from "../lib/record-folders";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { chatRecords } from "../lib/records/chat-records";
import { publisher } from "../rpc/publisher";
import { type RelativePath } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema, type ChatId } from "../schemas/chat-id";
import { type WebSearchClient } from "../schemas/web-search";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { sessionToShorthand } from "../test/helpers/session-to-shorthand";
import { TOOLS } from "../tools/all";
import {
  sessionMachine,
  type SessionMachineParentEvent,
  STOP_FAILSAFE_MS,
} from "./session";
import { REQUEST_ABORT_BACKSTOP_MS } from "./agent";

vi.mock(import("ulid"));
vi.mock(import("../lib/get-current-date"));
vi.mock(import("dugite"));
vi.mock(import("execa"), () => ({
  execa: vi.fn(),
}));

type Part =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer T>
    ? T
    : never;

/**
 * A model stream the test feeds by hand. Nothing arrives until the test pushes
 * it, so a test can hold a request open for as long as it likes without
 * relying on wall-clock delays to outrun the machine.
 */
function createManualModelStream() {
  const { readable, writable } = new TransformStream<Part, Part>();
  const writer = writable.getWriter();
  return {
    close: () => void writer.close().catch(noop),
    push: (chunk: Part) => void writer.write(chunk).catch(noop),
    stream: readable,
  };
}

describe("sessionMachine", () => {
  const chatFolder = "pj-test";

  /**
   * Runs the session as a chat's, where a question goes on a card; a task's
   * question has nobody to see it, and fails.
   */
  function answersAsChat() {
    vi.spyOn(recordFolders, "resolveChat").mockImplementation((id) =>
      id === chatFolder ? ChatIdSchema.parse(chatFolder) : undefined,
    );
    vi.spyOn(children, "sessionRole").mockImplementation((id) =>
      id === chatFolder ? "chat" : undefined,
    );
  }
  const defaultSessionId = StoreId.newSessionId();
  const mockDate = new Date("2025-01-01T00:00:00.000Z");
  const defaultMessageId = StoreId.newMessageId();
  const defaultQueuedMessage: SessionMessage.UserWithParts = {
    id: defaultMessageId,
    metadata: {
      createdAt: mockDate,
      sessionId: defaultSessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: mockDate,
          id: StoreId.newPartId(),
          messageId: defaultMessageId,
          sessionId: defaultSessionId,
        },
        text: "Hello, I need help with something.",
        type: "text",
      },
    ],
    role: "user",
  };
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

  const readFileChunks = [
    {
      id: "test-call-1",
      toolName: "read_file",
      type: "tool-input-start",
    },
    {
      input: JSON.stringify({
        filePath: "test.txt",
      }),
      toolCallId: "test-call-1",
      toolName: "read_file",
      type: "tool-call",
    },
  ] as const satisfies LanguageModelV4StreamPart[];

  const writeFileChunks = [
    {
      id: "test-call-2",
      toolName: "write_file",
      type: "tool-input-start",
    },
    {
      input: JSON.stringify({
        content: "console.log('Hello, world!');",
        filePath: "test.txt",
      }),
      toolCallId: "test-call-2",
      toolName: "write_file",
      type: "tool-call",
    },
  ] as const satisfies LanguageModelV4StreamPart[];

  const finishChunks = [
    { id: "1", type: "text-start" },
    { delta: "I'm done.", id: "1", type: "text-delta" },
    { id: "1", type: "text-end" },
    {
      finishReason: { raw: "stop", unified: "stop" },
      type: "finish",
      usage: mockUsage,
    },
  ] as const satisfies LanguageModelV4StreamPart[];

  // Appended to every mocked chunk set so each model turn ends the same way.
  const streamFinishChunk = {
    finishReason: { raw: "stop", unified: "stop" },
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
  } as const satisfies LanguageModelV4StreamPart;

  const chooseToolCallId = "test-call-choose";
  const chooseChunks = [
    {
      id: chooseToolCallId,
      toolName: "choose",
      type: "tool-input-start",
    },
    {
      input: JSON.stringify({
        choices: ["Continue", "Stop", "Restart"],
        question: "What would you like to do next?",
      }),
      toolCallId: chooseToolCallId,
      toolName: "choose",
      type: "tool-call",
    },
  ] as const satisfies LanguageModelV4StreamPart[];

  beforeEach(async () => {
    const { execa } = await import("execa");
    (execa as unknown as Mock).mockImplementation(
      () => () =>
        Promise.resolve({
          exitCode: 0,
          stderr: "mocked stderr",
          stdout: "mocked stdout",
        }),
    );
  });

  afterEach(async () => {
    // The chat's records stay folded in memory for as long as anything holds
    // the chat, so letting go of it is what keeps one case's messages out of
    // the next, which all of them write into the same session.
    await chatRecords().close(ChatIdSchema.parse(chatFolder));
    mockFs.restore();
    vi.restoreAllMocks();
  });

  async function createActorAndTask({
    actorOptions,
    agent = instrumentAgent,
    aiSDKModel,
    baseLLMRetryDelayMs = 1000,
    chunkDelayMs,
    chunkSets = [],
    imageModel,
    initialChunkDelaysMs = [],
    llmRequestChunkTimeoutMs = 120_000,
    machine = sessionMachine,
    maxStepCount,
    modelFeatures,
    providerConfigId = "mock-provider-config-id",
    queuedMessages = [defaultQueuedMessage],
    runRequested,
    sessionId = defaultSessionId,
    webSearch,
    webSearchModel,
  }: {
    actorOptions?: Pick<
      ActorOptions<typeof sessionMachine>,
      "clock" | "inspect"
    >;
    agent?: AnyAgent;
    aiSDKModel?: LanguageModelV4;
    baseLLMRetryDelayMs?: number;
    /** Between every chunk, for a test about something landing mid-stream. */
    chunkDelayMs?: number;
    chunkSets?: Part[][];
    imageModel?: ImageModelV4;
    initialChunkDelaysMs?: number[];
    llmRequestChunkTimeoutMs?: number;
    /** The session machine with test stand-ins provided. */
    machine?: typeof sessionMachine;
    maxStepCount?: number;
    /** What the model takes and gives; the mock's text-and-tools default otherwise. */
    modelFeatures?: AIGatewayModel.ModelFeatures[];
    providerConfigId?: string;
    queuedMessages?: SessionMessage.UserWithParts[];
    runRequested?: boolean;
    sessionId?: StoreId.Session;
    webSearch?: WebSearchClient;
    webSearchModel?: AISDKWebSearchModelResult;
  }) {
    let currentChunkIndex = 0;
    const mockLanguageModel = new MockLanguageModelV4({
      doStream: async () => {
        const currentChunks = chunkSets[currentChunkIndex];
        if (!currentChunks) {
          throw new Error("No chunks left");
        }

        const chunkIndex = currentChunkIndex;
        currentChunkIndex++;

        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          stream: simulateReadableStream({
            chunkDelayInMs: chunkDelayMs,
            chunks: [...currentChunks, streamFinishChunk],
            initialDelayInMs: initialChunkDelaysMs[chunkIndex],
          }),
        };
      },
    });

    // Provider config id defaults to the shared mock; the parallel-sessions
    // test passes distinct ids so each session resolves its own model override
    // via the workspace singleton.
    const model = createMockAIGatewayModel({
      features: modelFeatures,
      providerConfigId,
    });

    const testTaskConfig = createMockChatConfig(
      ChatIdSchema.parse(chatFolder),
      {
        aiSDKModel: aiSDKModel ?? mockLanguageModel,
        imageModel,
        model,
        webSearch,
        webSearchModel,
      },
    );

    await ChatWrites.saveSession(
      {
        createdAt: mockDate,
        id: sessionId,
        title: "Test session",
      },
      testTaskConfig,
    );

    const actor = createActor(machine, {
      ...actorOptions,
      input: {
        agent,
        baseLLMRetryDelayMs,
        llmRequestChunkTimeoutMs,
        maxStepCount,
        model,
        parentRef: {
          send: vi
            .fn()
            .mockImplementation((event: SessionMachineParentEvent) => {
              if (event.value.error) {
                console.error("session.done error", event.value.error);
              }
            }),
        } as unknown as AnyActorRef,
        queuedMessages,
        runRequested,
        savedMessageIds: [],
        sessionId,
        chatId: testTaskConfig,
      },
      // Uncomment to debug
      // inspect(event) {
      //   let name: string;
      //   if (typeof event.actorRef.src === "string") {
      //     name = event.actorRef.src;
      //   } else if (
      //     typeof event.actorRef.src === "object" &&
      //     "id" in event.actorRef.src
      //   ) {
      //     name = (event.actorRef.src as { id: string }).id;
      //   } else {
      //     name = "";
      //   }
      //   switch (event.type) {
      //     case "@xstate.action": {
      //       if (
      //         !event.action.type.startsWith("xstate.") &&
      //         event.action.type !== "actions"
      //       ) {
      //         // eslint-disable-next-line no-console
      //         console.log("action", name, event.actorRef.id, event.action.type);
      //       }

      //       break;
      //     }
      //     case "@xstate.event": {
      //       if (!event.event.type.startsWith("xstate.")) {
      //         // eslint-disable-next-line no-console
      //         console.log(
      //           "event",
      //           name,
      //           event.actorRef.id,
      //           event.event.type,
      //           "value" in event.event ? event.event.value : event.event,
      //         );
      //       }

      //       break;
      //     }
      //   }
      // },
    });

    return { actor, sessionId, chatId: testTaskConfig };
  }

  async function runTestMachine({
    actor,
    sessionId,
    chatId,
  }: {
    actor: ActorRefFrom<typeof sessionMachine>;
    sessionId: StoreId.Session;
    chatId: ChatId;
  }) {
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    return ChatReads.sessionWithMessages({ chatId, sessionId });
  }

  async function createAndRunTestMachine(
    options: Parameters<typeof createActorAndTask>[0],
  ) {
    const result = await createActorAndTask(options);
    return runTestMachine(result);
  }

  beforeEach(() => {
    mockFs({
      [MOCK_WORKSPACE_DIRS.chats]: { [chatFolder]: {} },
      [MOCK_WORKSPACE_DIRS.work]: {
        [chatFolder]: {
          "image.png": mockFs.load(
            path.resolve(
              import.meta.dirname,
              "../../fixtures/assets/image.png",
            ),
          ),
          "test.txt": "Hello, world!",
        },
      },
    });
  });

  it("should read and write a file", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [readFileChunks, writeFileChunks, finishChunks],
    });
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(
      `
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <tool tool="write_file" state="output-available" callId="test-call-2">
            <input>
              {
                "filePath": "test.txt",
                "content": "console.log('Hello, world!');"
              }
            </input>
            <output>
              {
                "content": "console.log('Hello, world!');",
                "filePath": "./test.txt",
                "isNewFile": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="3" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `,
    );
  });

  it("should read an image file", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [
        [
          {
            id: "test-call-image",
            toolName: "read_file",
            type: "tool-input-start",
          },
          {
            input: JSON.stringify({
              filePath: "image.png",
            }),
            toolCallId: "test-call-image",
            toolName: "read_file",
            type: "tool-call",
          },
        ],
        finishChunks,
      ],
      modelFeatures: ["inputText", "inputImage", "outputText", "tools"],
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="5">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-image">
            <input>
              {
                "filePath": "image.png"
              }
            </input>
            <output>
              {
                "filePath": "./image.png",
                "mimeType": "image/png",
                "state": "image",
                "height": 75,
                "viewHeight": 75,
                "viewWidth": 100,
                "width": 100,
                "base64Data": "iVBORw0KGgoAAAANSUhEUgAAAGQAAABLAQMAAAC81rD0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABlBMVEUAAP7////DYP5JAAAAAWJLR0QB/wIt3gAAAAlwSFlzAAALEgAACxIB0t1+/AAAAAd0SU1FB+QIGBcKN7/nP/UAAAASSURBVDjLY2AYBaNgFIwCdAAABBoAAaNglfsAAAAZdEVYdGNvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVDnr0DLAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDIwLTA4LTI0VDIzOjEwOjU1KzAzOjAwkHdeuQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyMC0wOC0yNFQyMzoxMDo1NSswMzowMOEq5gUAAAAASUVORK5CYII="
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("should generate an image", async () => {
    const generateImageChunks = [
      {
        id: "test-call-generate-image",
        toolName: "generate_image",
        type: "tool-input-start",
      },
      {
        input: JSON.stringify({
          explanation: "Generate a test image",
          filePath: "generated-image",
          prompt: "A beautiful sunset over mountains",
        }),
        toolCallId: "test-call-generate-image",
        toolName: "generate_image",
        type: "tool-call",
      },
    ] as const satisfies LanguageModelV4StreamPart[];

    const mockImageModel: ImageModelV4 = {
      doGenerate: vi.fn().mockResolvedValue({
        images: [
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        ],
        rawResponse: { headers: {} },
        usage: {
          inputTokens: 10,
          outputTokens: 0,
          totalTokens: 10,
        },
        warnings: [],
      }),
      maxImagesPerCall: undefined,
      modelId: "mock-image-model",
      provider: "mock-provider",
      specificationVersion: "v4",
    };

    const session = await createAndRunTestMachine({
      chunkSets: [generateImageChunks, finishChunks],
      imageModel: mockImageModel,
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="5">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="generate_image" state="output-available" callId="test-call-generate-image">
            <input>
              {
                "explanation": "Generate a test image",
                "filePath": "generated-image",
                "prompt": "A beautiful sunset over mountains"
              }
            </input>
            <output>
              {
                "appliedParameters": {},
                "images": [
                  {
                    "filePath": "generated-image.png",
                    "height": 1,
                    "width": 1,
                    "sizeBytes": 70
                  }
                ],
                "modelId": "mock-image-model",
                "provider": {
                  "id": "mock-provider-config-id",
                  "type": "instrument"
                },
                "renamedToAvoidOverwrite": false,
                "state": "success",
                "usage": {
                  "inputTokens": 10,
                  "outputTokens": 0,
                  "totalTokens": 10
                }
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("should perform a web search", async () => {
    const webSearchChunks = [
      {
        id: "test-call-web-search",
        toolName: "web_search",
        type: "tool-input-start",
      },
      {
        input: JSON.stringify({
          explanation: "Search for latest news",
          query: "latest TypeScript features",
        }),
        toolCallId: "test-call-web-search",
        toolName: "web_search",
        type: "tool-call",
      },
    ] as const satisfies LanguageModelV4StreamPart[];

    // The session's model is one of ours, so the search runs against our own
    // endpoint rather than a provider's search model.
    const searchWeb: WebSearchClient = () =>
      Promise.resolve({
        data: {
          results: [
            {
              text: "TypeScript 5.7 introduces new features.",
              title: "TypeScript Blog",
              url: "https://devblogs.microsoft.com/typescript",
            },
          ],
        },
        ok: true,
      });

    const session = await createAndRunTestMachine({
      chunkSets: [webSearchChunks, finishChunks],
      webSearch: searchWeb,
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="5">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="web_search" state="output-available" callId="test-call-web-search">
            <input>
              {
                "explanation": "Search for latest news",
                "query": "latest TypeScript features"
              }
            </input>
            <output>
              {
                "results": {
                  "kind": "excerpts",
                  "sources": [
                    {
                      "text": "TypeScript 5.7 introduces new features.",
                      "title": "TypeScript Blog",
                      "url": "https://devblogs.microsoft.com/typescript"
                    }
                  ]
                },
                "state": "success"
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("should handle multiple actors running in parallel", async () => {
    const result1 = await createActorAndTask({
      chunkSets: [
        [
          { id: "1", type: "text-start" },
          { delta: "First session", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
          {
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: mockUsage,
          },
        ],
      ],
      providerConfigId: "mock-provider-config-1",
      sessionId: defaultSessionId,
    });

    const secondSessionId = StoreId.newSessionId();
    const secondMessageId = StoreId.newMessageId();
    const result2 = await createActorAndTask({
      chunkSets: [
        [
          { id: "1", type: "text-start" },
          { delta: "Second assistant message", id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
          {
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: mockUsage,
          },
        ],
      ],
      providerConfigId: "mock-provider-config-2",
      queuedMessages: [
        {
          id: secondMessageId,
          metadata: {
            createdAt: mockDate,
            sessionId: secondSessionId,
          },
          parts: [
            {
              metadata: {
                createdAt: mockDate,
                id: StoreId.newPartId(),
                messageId: secondMessageId,
                sessionId: secondSessionId,
              },
              text: "Second user message",
              type: "text",
            },
          ],
          role: "user",
        },
      ],
      sessionId: secondSessionId,
    });

    const sessionResult1 = await runTestMachine(result1);
    const sessionResult2 = await runTestMachine(result2);
    expect(sessionToShorthand(sessionResult1)).toMatchInlineSnapshot(`
      "<session title="Test session" count="4">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <text state="done">First session</text>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
      </session>"
    `);

    expect(sessionToShorthand(sessionResult2)).toMatchInlineSnapshot(
      `
      "<session title="Test session" count="4">
        <user>
          <text>Second user message</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <text state="done">Second assistant message</text>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
      </session>"
    `,
    );
  });

  it("retry with invalid tool name", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [
        [
          readFileChunks[0],
          {
            ...readFileChunks[1],
            toolName: "invalid_tool_name",
          },
        ],
        readFileChunks,
        finishChunks,
      ],
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="unavailable" state="output-error" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <error>Model tried to call unavailable tool 'invalid_tool_name'. Available tools: ask_permission, bash, choose, connect_app, edit_file, generate_image, load_skill, offer_feedback, read_file, web_fetch, web_search, write_file.</error>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="3" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("retry with invalid tool params", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [
        [
          readFileChunks[0],
          {
            ...readFileChunks[1],
            input: JSON.stringify({
              filePath: "invalid/path/structure",
            }),
            toolCallId: "test-call-1",
          },
        ],
        readFileChunks,
        finishChunks,
      ],
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "invalid/path/structure"
              }
            </input>
            <output>
              {
                "filePath": "./invalid/path/structure",
                "state": "does-not-exist",
                "suggestions": []
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="3" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("should stop after two steps with file read success", async () => {
    const neverMessage = "NEVER";
    const session = await createAndRunTestMachine({
      chunkSets: [
        readFileChunks,
        readFileChunks,
        finishChunks,
        [
          { id: "1", type: "text-start" },
          { delta: neverMessage, id: "1", type: "text-delta" },
          { id: "1", type: "text-end" },
          {
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: mockUsage,
          },
        ],
      ],
    });

    expect(sessionToShorthand(session)).not.toContain(neverMessage);
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="3" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  it("should immediately exit when no tools are called", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [finishChunks],
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="4">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <text state="done">I'm done.</text>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
      </session>"
    `);
  });

  it("gives a reply naming a file that is not there one step to correct it, and no more", async () => {
    answersAsChat();
    const replying = (text: string) =>
      [
        { id: "1", type: "text-start" },
        { delta: text, id: "1", type: "text-delta" },
        { id: "1", type: "text-end" },
      ] as const satisfies LanguageModelV4StreamPart[];
    const dead = "Made it.\n\n```files\nsquares.csv\n```";
    const prompts: string[] = [];
    const replies = [dead, dead];
    const aiSDKModel = new MockLanguageModelV4({
      doStream: (options) => {
        prompts.push(JSON.stringify(options.prompt.at(-1)));
        const text = replies.shift();
        if (text === undefined) {
          throw new Error("No chunks left");
        }
        return Promise.resolve({
          rawCall: { rawPrompt: null, rawSettings: {} },
          stream: simulateReadableStream({
            chunks: [...replying(text), streamFinishChunk],
          }),
        });
      },
    });

    const session = await runTestMachine(
      await createActorAndTask({ aiSDKModel }),
    );

    expect(
      session
        ._unsafeUnwrap()
        .messages.filter((message) => message.role === "assistant").length,
    ).toBe(2);
    expect(prompts.map((prompt) => prompt.includes("open nothing"))).toEqual([
      false,
      true,
    ]);
  });

  it("says on the record change feed when its agent moves, as well as what it writes", async () => {
    const result = await createActorAndTask({ chunkSets: [finishChunks] });
    const kinds = new Set<string>();
    const stop = publisher.subscribe("record.changed", (change) => {
      if (change.id === result.chatId) {
        kinds.add(change.kind);
      }
    });
    await runTestMachine(result);
    stop();
    // Its messages and its agent, and nothing of the session itself: a
    // session's own records are its header, where its context was reset, who
    // stopped it and what it was told, and a turn writes none of those.
    expect([...kinds].toSorted()).toEqual(["agent", "messages"]);
  });

  it("should stop agents during llm request", async () => {
    const result = await createActorAndTask({
      chunkSets: [finishChunks],
    });
    result.actor.start();
    await waitFor(result.actor, (state) => state.matches({ Agent: "Running" }));
    result.actor.send({ type: "stop" });
    await waitFor(result.actor, (state) => state.status === "done");

    const session = await runTestMachine(result);
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
        "<session title="Test session" count="1">
          <user>
            <text>Hello, I need help with something.</text>
          </user>
        </session>"
      `);
  });

  it("keeps a message stopped before its turn starts unanswered, and says whose stop it was", async () => {
    const result = await createActorAndTask({
      chunkSets: [finishChunks],
    });
    const done: unknown[] = [];
    const unsubscribe = publisher.subscribe("session.done", (payload) => {
      done.push(payload);
    });
    result.actor.start();
    expect(result.actor.getSnapshot().matches("UpdatingSession")).toBe(true);
    result.actor.send({
      notice: { by: "person", wakesChat: false },
      type: "stop",
    });

    const session = await runTestMachine(result);
    unsubscribe();
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="1">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
      </session>"
    `);
    expect(done).toEqual([
      {
        id: result.chatId,
        notice: { by: "person", wakesChat: false },
        sessionId: result.sessionId,
      },
    ]);
  });

  it("keeps the user's stop when the chat's own stop lands after it", async () => {
    const result = await createActorAndTask({
      chunkSets: [finishChunks],
    });
    const done: unknown[] = [];
    const unsubscribe = publisher.subscribe("session.done", (payload) => {
      done.push(payload);
    });
    result.actor.start();
    result.actor.send({
      notice: { by: "person", wakesChat: true },
      type: "stop",
    });
    result.actor.send({
      notice: { by: "agent", wakesChat: false },
      type: "stop",
    });

    await runTestMachine(result);
    unsubscribe();
    expect(done).toEqual([
      {
        id: result.chatId,
        notice: { by: "person", wakesChat: true },
        sessionId: result.sessionId,
      },
    ]);
  });

  /** The one agent, finishing its turn with `onFinish` in place of its own. */
  function agentFinishingWith(onFinish: () => Promise<void>) {
    return setupAgent({
      agentTools: pick(TOOLS, ["ReadFile"]),
      name: "instrument",
    }).create(() => ({
      getMessages: instrumentAgent.getMessages,
      onFinish,
      onStart: instrumentAgent.onStart,
      shouldContinue: instrumentAgent.shouldContinue,
      systemPrompt: instrumentAgent.systemPrompt,
    }));
  }

  // A quit stops every session still alive, a stopped one winding down
  // included, and a stop that lands while the turn finishes must not run
  // the finish again: it consumes the turn's skill changes as it reads them.
  it("finishes a stopped turn once when the app's quit stops it again", async () => {
    const stream = createManualModelStream();
    let finishes = 0;
    let releaseFinish!: () => void;
    const finishGate = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const result = await createActorAndTask({
      agent: agentFinishingWith(async () => {
        finishes++;
        await finishGate;
      }),
      aiSDKModel: new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            rawCall: { rawPrompt: null, rawSettings: {} },
            stream: stream.stream,
          }),
      }),
    });
    const done: unknown[] = [];
    const unsubscribe = publisher.subscribe("session.done", (payload) => {
      done.push(payload);
    });
    result.actor.start();
    await waitFor(result.actor, (state) => state.matches({ Agent: "Running" }));
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }
    await waitFor(agentRef, (state) => state.matches("LLMStreaming"));

    result.actor.send({
      notice: { by: "person", wakesChat: false },
      type: "stop",
    });
    await vi.waitFor(() => {
      expect(finishes).toBe(1);
    });
    result.actor.send({
      notice: { by: "app", wakesChat: false },
      reason: "quit",
      type: "stop",
    });
    releaseFinish();
    await waitFor(result.actor, (state) => state.status === "done");
    unsubscribe();

    expect(finishes).toBe(1);
    expect(done).toEqual([
      {
        id: result.chatId,
        notice: { by: "person", wakesChat: false },
        sessionId: result.sessionId,
      },
    ]);
  });

  // The failsafe bounds the whole stop from the moment it was asked for; a
  // second stop pushing it out would let a turn that never winds down hold
  // the session for as long as stops keep arriving.
  it("keeps the stop failsafe's deadline when the chat's stop follows the user's", async () => {
    const clock = new SimulatedClock();
    const result = await createActorAndTask({
      actorOptions: { clock },
      agent: agentFinishingWith(() => new Promise<void>(noop)),
      chunkSets: [finishChunks],
    });
    result.actor.start();
    await waitFor(result.actor, (state) => state.matches({ Agent: "Running" }));
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }
    await waitFor(agentRef, (state) => state.matches("Finishing"));

    result.actor.send({
      notice: { by: "person", wakesChat: false },
      type: "stop",
    });
    clock.increment(STOP_FAILSAFE_MS - 100);
    result.actor.send({
      notice: { by: "agent", wakesChat: false },
      reason: "chat",
      type: "stop",
    });
    clock.increment(100);

    await waitFor(result.actor, (state) => state.status === "done", {
      timeout: 1000,
    });
    expect(agentRef.getSnapshot().status).toBe("stopped");
  });

  it("should force stop agents before the stopping failsafe completes", async () => {
    const clock = new SimulatedClock();
    let finishOnFinish: (() => void) | undefined;
    const onFinishPromise = new Promise<void>((resolve) => {
      finishOnFinish = resolve;
    });
    const result = await createActorAndTask({
      actorOptions: { clock },
      agent: agentFinishingWith(() => onFinishPromise),
      chunkSets: [finishChunks],
    });
    result.actor.start();

    await waitFor(result.actor, (state) => state.matches({ Agent: "Running" }));
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }

    result.actor.send({ type: "stop" });
    clock.increment(STOP_FAILSAFE_MS);
    await waitFor(result.actor, (state) => state.status === "done");

    const snapshot = result.actor.getSnapshot();
    expect(snapshot.hasTag("agent.alive")).toBe(false);
    expect(snapshot.context.agentRef).toBeUndefined();
    expect(agentRef.getSnapshot().status).toBe("stopped");

    finishOnFinish?.();
  });

  // A turn stopped outright leaves nothing of the agent to write what its
  // request was holding, so the session writes it before it says it is done.
  it("writes what a force-stopped turn held as cut off before the session ends", async () => {
    const clock = new SimulatedClock();
    const stream = createManualModelStream();
    const result = await createActorAndTask({
      actorOptions: { clock },
      agent: agentFinishingWith(() => new Promise<void>(noop)),
      aiSDKModel: new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            rawCall: { rawPrompt: null, rawSettings: {} },
            stream: stream.stream,
          }),
      }),
    });
    // A save that ignores the abort, holding the request past its backstop
    // with its reply still arriving.
    let stuck = false;
    const savePart = ChatWrites.savePart;
    vi.spyOn(ChatWrites, "savePart").mockImplementation((part, chatId) => {
      if (part.type === "text" && part.text.endsWith("held up")) {
        stuck = true;
        return ResultAsync.fromSafePromise(new Promise<void>(noop)).andThen(
          () => savePart(part, chatId),
        );
      }
      return savePart(part, chatId);
    });
    async function replyParts() {
      const transcript = await ChatReads.transcript({
        chatId: result.chatId,
        sessionId: result.sessionId,
      });
      return transcript
        ._unsafeUnwrap()
        .flatMap((message) =>
          message.role === "assistant" ? message.parts : [],
        )
        .flatMap((part): object[] => {
          if (part.type === "text") {
            return [pick(part, ["state", "text"])];
          }
          if (part.type === "tool-read_file") {
            return [
              {
                errorText:
                  part.state === "output-error" ? part.errorText : undefined,
                state: part.state,
              },
            ];
          }
          return [];
        });
    }
    let partsAtDone: ReturnType<typeof replyParts> | undefined;
    const unsubscribe = publisher.subscribe("session.done", () => {
      partsAtDone ??= replyParts();
    });

    result.actor.start();
    stream.push({ id: "1", type: "text-start" });
    stream.push({ delta: "Reading it", id: "1", type: "text-delta" });
    stream.push({
      id: "call-1",
      toolName: "read_file",
      type: "tool-input-start",
    });
    stream.push({ delta: ", held up", id: "1", type: "text-delta" });
    await vi.waitFor(() => {
      expect(stuck).toBe(true);
    });

    result.actor.send({
      notice: { by: "person", wakesChat: false },
      type: "stop",
    });
    clock.increment(STOP_FAILSAFE_MS);
    await waitFor(result.actor, (state) => state.status === "done");
    unsubscribe();

    expect(await partsAtDone).toMatchInlineSnapshot(`
      [
        {
          "state": "done",
          "text": "Reading it, held up",
        },
        {
          "errorText": "This action was cut off before it could run.",
          "state": "output-error",
        },
      ]
    `);
  });

  it("ends the turn on a chat's choose and leaves the question open", async () => {
    answersAsChat();
    const result = await createActorAndTask({
      agent: setupAgent({
        agentTools: pick(TOOLS, ["Choose"]),
        name: "instrument",
      }).create(() => ({
        getMessages: instrumentAgent.getMessages,
        onFinish: instrumentAgent.onFinish,
        onStart: instrumentAgent.onStart,
        shouldContinue: instrumentAgent.shouldContinue,
        systemPrompt: instrumentAgent.systemPrompt,
      })),
      chunkSets: [chooseChunks, finishChunks],
    });

    const session = await runTestMachine(result);
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="5">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="choose" state="output-available" callId="test-call-choose">
            <input>
              {
                "choices": [
                  "Continue",
                  "Stop",
                  "Restart"
                ],
                "question": "What would you like to do next?"
              }
            </input>
            <output>
              {
                "asked": true
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
    // The open question is read from the chat's own session.
    vi.spyOn(recordFolders, "sessionOfChat").mockReturnValue(result.sessionId);
    expect(
      (await openAsks(ChatIdSchema.parse(chatFolder))).map((ask) =>
        ask.kind === "question" ? ask.question : ask.target,
      ),
    ).toEqual(["What would you like to do next?"]);
  });

  /** Why each reply a session's turn cut off was cut off, oldest first. */
  function abortReasons(
    session: Awaited<ReturnType<typeof ChatReads.sessionWithMessages>>,
  ) {
    return session
      ._unsafeUnwrap()
      .messages.flatMap((message) =>
        message.role === "assistant" &&
        message.metadata.error?.kind === "aborted"
          ? [message.metadata.error.reason]
          : [],
      );
  }

  it("says a reply the user stopped was cut off by their stop", async () => {
    const result = await createActorAndTask({
      chunkSets: [finishChunks],
      initialChunkDelaysMs: [5000],
    });
    result.actor.start();
    // The reply is stored as its request goes out, before any of it arrives.
    await vi.waitFor(async () => {
      const session = await ChatReads.sessionWithMessages({
        chatId: result.chatId,
        sessionId: result.sessionId,
      });
      expect(
        session
          ._unsafeUnwrap()
          .messages.some((message) => message.role === "assistant"),
      ).toBe(true);
    });
    result.actor.send({ type: "stop" });
    await waitFor(result.actor, (state) => state.status === "done");

    await vi.waitFor(async () => {
      expect(
        abortReasons(
          await ChatReads.sessionWithMessages({
            chatId: result.chatId,
            sessionId: result.sessionId,
          }),
        ),
      ).toEqual(["manual"]);
    });
  });

  // The chat's folder is written as each turn ends (`on-turn-end.ts`), from
  // the records on disk, so the words a stopped reply had reached have to be
  // written by then. Read once this session is done, not on the first
  // `session.done` the process publishes, which any session can send.
  it("writes a stopped reply's words before its turn ends", async () => {
    const stream = createManualModelStream();
    const result = await createActorAndTask({
      aiSDKModel: new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve({
            rawCall: { rawPrompt: null, rawSettings: {} },
            stream: stream.stream,
          }),
      }),
    });
    const rootDir = MOCK_WORKSPACE_DIRS.root;
    let folder: string | undefined;
    const transcript = async () => {
      const written = await writeChatFolder({
        chatsDir: MOCK_WORKSPACE_DIRS.chats,
        id: result.chatId,
        machineDir: MOCK_WORKSPACE_DIRS.machine,
        rootDir,
      });
      if (written.kind === "written") {
        folder = written.folder;
      } else if (written.kind !== "already-there" || folder === undefined) {
        throw new Error(`Expected a written folder, got ${written.kind}`);
      }
      return fs.readFile(
        path.join(rootDir, CHATS_FOLDER_NAME, folder, CHAT_FILE_NAME),
        "utf8",
      );
    };
    result.actor.start();
    stream.push({ id: "1", type: "text-start" });
    stream.push({ delta: "Half of the answer", id: "1", type: "text-delta" });
    // Held by the turn, which every read sees and nothing has written yet.
    // The reply's own words: the user's message and the session's context
    // are text too, and are there before the request has read a chunk.
    await vi.waitFor(async () => {
      const messages = await ChatReads.transcript({
        chatId: result.chatId,
        sessionId: result.sessionId,
      });
      expect(
        messages
          ._unsafeUnwrap()
          .filter((message) => message.role === "assistant")
          .flatMap((message) => message.parts)
          .some(
            (part) =>
              part.type === "text" && part.text.includes("Half of the answer"),
          ),
      ).toBe(true);
    });

    result.actor.send({ type: "stop" });
    await waitFor(result.actor, (state) => state.status === "done");

    const atDone = await transcript();
    if (!atDone.includes("Half of the answer")) {
      // Which of two causes: the words landing after the turn ended, or
      // never landing at all.
      const landedLater = await vi
        .waitFor(async () => {
          expect(await transcript()).toContain("Half of the answer");
        })
        .then(
          () => true,
          () => false,
        );
      expect.fail(
        landedLater
          ? "The stopped reply's words reached the disk only after its session was done."
          : `The stopped reply's words never reached the disk:\n${atDone}`,
      );
    }
  });

  it("should retry and fail on timeout", async () => {
    const chunkTimeoutMs = 500;
    const session = await createAndRunTestMachine({
      baseLLMRetryDelayMs: 0,
      chunkSets: [readFileChunks, readFileChunks, readFileChunks, finishChunks],
      initialChunkDelaysMs: [chunkTimeoutMs * 2, chunkTimeoutMs * 2, 1, 1],
      llmRequestChunkTimeoutMs: chunkTimeoutMs,
    });
    // Cut off by its request timing out, which nobody asked for.
    expect(abortReasons(session)).toEqual(["timeout", "timeout"]);

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="7">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="aborted" model="mock-model-id" provider="instrument" errorKind="aborted" errorMessage="Aborted">
          <step-start step="1" />
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="aborted" model="mock-model-id" provider="instrument" errorKind="aborted" errorMessage="Aborted">
          <step-start step="1" />
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  });

  // A request held up past its backstop is left behind still running, and the
  // retry streams beside it. What the late one writes on its way out is its
  // own reply's, never the retry's.
  it("leaves the retry's reply arriving when the attempt before it returns late", async () => {
    const clock = new SimulatedClock();
    const chunkTimeoutMs = 100;
    const retryDelayMs = 10;
    const attempts: ReturnType<typeof createManualModelStream>[] = [];
    const result = await createActorAndTask({
      actorOptions: { clock },
      aiSDKModel: new MockLanguageModelV4({
        doStream: () => {
          const attempt = createManualModelStream();
          attempts.push(attempt);
          return Promise.resolve({
            rawCall: { rawPrompt: null, rawSettings: {} },
            stream: attempt.stream,
          });
        },
      }),
      baseLLMRetryDelayMs: retryDelayMs,
      llmRequestChunkTimeoutMs: chunkTimeoutMs,
    });

    // A save that ignores the abort, the way a write behind a slow disk does,
    // holding the first request past its backstop.
    let stuck = false;
    let unstick!: () => void;
    const unstuck = new Promise<void>((resolve) => {
      unstick = resolve;
    });
    const savePart = ChatWrites.savePart;
    vi.spyOn(ChatWrites, "savePart").mockImplementation((part, chatId) => {
      if (part.type === "text" && part.text.endsWith("held up")) {
        stuck = true;
        return ResultAsync.fromSafePromise(unstuck).andThen(() =>
          savePart(part, chatId),
        );
      }
      return savePart(part, chatId);
    });

    async function textParts() {
      const transcript = await ChatReads.transcript({
        chatId: result.chatId,
        sessionId: result.sessionId,
      });
      return transcript
        ._unsafeUnwrap()
        .flatMap((message) =>
          message.role === "assistant" ? message.parts : [],
        )
        .flatMap((part) =>
          part.type === "text" ? [pick(part, ["state", "text"])] : [],
        );
    }

    result.actor.start();
    await vi.waitFor(() => {
      expect(attempts).toHaveLength(1);
    });
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }
    const [first] = attempts;
    first?.push({ id: "1", type: "text-start" });
    first?.push({ delta: "First attempt, ", id: "1", type: "text-delta" });
    first?.push({ delta: "held up", id: "1", type: "text-delta" });
    await vi.waitFor(() => {
      expect(stuck).toBe(true);
    });

    clock.increment(chunkTimeoutMs);
    expect(agentRef.getSnapshot().matches({ LLMStreaming: "Aborting" })).toBe(
      true,
    );
    clock.increment(REQUEST_ABORT_BACKSTOP_MS);
    await waitFor(agentRef, (state) => state.matches("RetryingWithDelay"));
    clock.increment(retryDelayMs);
    await vi.waitFor(() => {
      expect(attempts).toHaveLength(2);
    });
    const second = attempts[1];
    second?.push({ id: "2", type: "text-start" });
    second?.push({ delta: "Second attempt", id: "2", type: "text-delta" });
    await vi.waitFor(async () => {
      expect(await textParts()).toContainEqual({
        state: "streaming",
        text: "Second attempt",
      });
    });

    // The first request returns, writing its own reply as it was cut off.
    unstick();
    await vi.waitFor(async () => {
      expect(await textParts()).toContainEqual({
        state: "done",
        text: "First attempt, held up",
      });
    });
    expect(await textParts()).toEqual([
      { state: "done", text: "First attempt, held up" },
      { state: "streaming", text: "Second attempt" },
    ]);

    second?.push({ delta: " finished.", id: "2", type: "text-delta" });
    second?.push({ id: "2", type: "text-end" });
    second?.push(streamFinishChunk);
    second?.close();
    await waitFor(result.actor, (state) => state.status === "done");
    expect(await textParts()).toEqual([
      { state: "done", text: "First attempt, held up" },
      { state: "done", text: "Second attempt finished." },
    ]);
  });

  // Every step waits on something the machine did rather than on elapsed time,
  // so the long test timeout only bounds a genuine hang.
  it("should extend timeout when chunks are received", async () => {
    const chunkTimeoutMs = 100;
    const retryDelayMs = 10;
    // Both the chunk deadline and the retry backoff run on a clock only this
    // test advances, and chunks are fed in by hand, so how long the machine
    // really takes to stream and store one cannot decide whether a request
    // times out.
    const clock = new SimulatedClock();

    const attempts: ReturnType<typeof createManualModelStream>[] = [];
    let chunksReceived = 0;
    let onProgress: (() => void) | undefined;

    const aiSDKModel = new MockLanguageModelV4({
      doStream: () => {
        const attempt = createManualModelStream();
        attempts.push(attempt);
        onProgress?.();
        return Promise.resolve({
          rawCall: { rawPrompt: null, rawSettings: {} },
          stream: attempt.stream,
        });
      },
    });

    const result = await createActorAndTask({
      actorOptions: {
        clock,
        inspect: (event) => {
          if (
            event.type === "@xstate.event" &&
            event.event.type === "llmRequest.chunkReceived"
          ) {
            chunksReceived++;
            onProgress?.();
          }
        },
      },
      aiSDKModel,
      baseLLMRetryDelayMs: retryDelayMs,
      llmRequestChunkTimeoutMs: chunkTimeoutMs,
    });

    // The two signals the test waits on: the model was asked for another
    // stream, and the agent took in another chunk, which is what resets its
    // deadline.
    async function waitForProgress(until: () => boolean) {
      while (!until()) {
        await new Promise<void>((resolve) => {
          onProgress = resolve;
        });
      }
    }

    async function waitForAttempt(index: number) {
      await waitForProgress(() => attempts.length > index);
      const attempt = attempts[index];
      if (!attempt) {
        throw new Error(`Expected attempt ${index}`);
      }
      return attempt;
    }

    result.actor.start();

    // First attempt: one chunk and then silence, so the deadline expires and
    // the agent retries. The clock waits for the turn to be holding the
    // streamed tool call, since the aborted message is expected to carry it.
    const stalled = await waitForAttempt(0);
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }

    stalled.push(readFileChunks[0]);
    await vi.waitFor(
      async () => {
        // The transcript, since a call still arriving is the turn's own
        // memory rather than anything the session's messages hold.
        const transcript = await ChatReads.transcript({
          chatId: result.chatId,
          sessionId: result.sessionId,
        });
        expect(
          transcript._unsafeUnwrap().flatMap((message) => message.parts),
        ).toContainEqual(expect.objectContaining({ state: "input-streaming" }));
      },
      { interval: 5, timeout: 10_000 },
    );
    clock.increment(chunkTimeoutMs);
    // The timed-out request returns before the retry waits out its backoff.
    await waitFor(agentRef, (state) => state.matches("RetryingWithDelay"));
    clock.increment(retryDelayMs);

    // Second attempt: each chunk lands a tick before the deadline and pushes it
    // back out, so the request outlives three timeout windows.
    const retried = await waitForAttempt(1);
    for (const chunk of [...readFileChunks, streamFinishChunk]) {
      clock.increment(chunkTimeoutMs - 1);
      // The deadline is younger than the clock jump, either because the
      // request just started or because the previous pass's chunk reset it, so
      // the agent is still streaming rather than waiting to retry.
      expect(agentRef.getSnapshot().matches("LLMStreaming")).toBe(true);
      const chunksBefore = chunksReceived;
      retried.push(chunk);
      await waitForProgress(() => chunksReceived > chunksBefore);
    }
    retried.close();

    // Third attempt ends the turn. The clock stands still from here, so nothing
    // downstream of the retry can time out.
    const finished = await waitForAttempt(2);
    for (const chunk of [...finishChunks, streamFinishChunk]) {
      finished.push(chunk);
    }
    finished.close();

    const session = await runTestMachine(result);
    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="aborted" model="mock-model-id" provider="instrument" errorKind="aborted" errorMessage="Aborted">
          <step-start step="1" />
          <tool tool="read_file" state="output-error" callId="test-call-1">
            <input>
              "none"
            </input>
            <error>This action was cut off before it could run.</error>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
      </session>"
    `);
  }, 30_000);

  describe("with write file delay", () => {
    beforeEach(() => {
      vi.spyOn(TOOLS.WriteFile, "execute").mockImplementation(async () => {
        // Forces the function to be async which will hit WaitingForToolCallExecutions
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return ok({
          content: "console.log('Hello, world!');",
          filePath: "test.js" as RelativePath,
          isNewFile: false,
          modifiedAt: 1_234_567_890,
        });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should stop agents during execution", async () => {
      const result = await createActorAndTask({
        chunkSets: [readFileChunks, writeFileChunks, finishChunks],
      });
      result.actor.start();

      await waitFor(
        result.actor,
        (state) =>
          state.matches({ Agent: "Running" }) &&
          state.context.agentRef?.getSnapshot().context.agent.name ===
            "instrument",
      ).then(async () => {
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          return;
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));
      });

      result.actor.send({ type: "stop" });
      await waitFor(result.actor, (state) => state.status === "done");

      const session = await runTestMachine(result);
      expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
        "<session title="Test session" count="4">
          <user>
            <text>Hello, I need help with something.</text>
          </user>
          <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
            <step-start step="1" />
            <tool tool="read_file" state="output-error" callId="test-call-1">
              <input>
                {
                  "filePath": "test.txt"
                }
              </input>
              <error>This action was stopped by you.</error>
            </tool>
          </assistant>
          <session-context instrument realRole="system" />
          <session-context instrument realRole="user" />
        </session>"
      `);
    });

    // What waits behind a turn the person stops is kept but not run: a
    // message or a wake note queued then would otherwise start the agent
    // again the moment it winds down. One sent after the Stop runs.
    it.each([{ after: false }, { after: true }])(
      "holds what was queued when the person stopped the turn, and runs what came after (sent after: $after)",
      async ({ after }) => {
        const result = await createActorAndTask({
          chunkSets: [readFileChunks, writeFileChunks, finishChunks],
        });
        result.actor.start();
        await waitFor(
          result.actor,
          (state) => state.context.agentRef !== undefined,
        );
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          throw new Error("The agent never started");
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));

        const messageId = StoreId.newMessageId();
        const queued: SessionMessage.UserWithParts = {
          id: messageId,
          metadata: { createdAt: mockDate, sessionId: defaultSessionId },
          parts: [
            {
              metadata: {
                createdAt: mockDate,
                id: StoreId.newPartId(),
                messageId,
                sessionId: defaultSessionId,
              },
              text: "One more thing.",
              type: "text",
            },
          ],
          role: "user",
        };
        const stop = () => {
          result.actor.send({
            notice: { by: "person", wakesChat: false },
            type: "stop",
          });
        };
        if (after) {
          stop();
        }
        result.actor.send({
          model: createMockAIGatewayModel(),
          type: "addMessage",
          value: queued,
        });
        if (!after) {
          stop();
        }

        const session = await runTestMachine(result);
        const shorthand = sessionToShorthand(session);
        expect(shorthand).toContain("<text>One more thing.</text>");
        // Answered only by a turn of its own after the stopped one.
        expect(shorthand.includes("I'm done.")).toBe(after);
      },
    );

    // The user writing again while the conversation replies stops the reply,
    // and the call it cut short says so rather than that the user stopped it.
    it("says a call was interrupted by a newer message when that is why it stopped", async () => {
      const result = await createActorAndTask({
        chunkSets: [readFileChunks, writeFileChunks, finishChunks],
      });
      result.actor.start();

      await waitFor(
        result.actor,
        (state) =>
          state.matches({ Agent: "Running" }) &&
          state.context.agentRef?.getSnapshot().context.agent.name ===
            "instrument",
      ).then(async () => {
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          return;
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));
      });

      result.actor.send({ reason: "superseded", type: "stop" });
      await waitFor(result.actor, (state) => state.status === "done");

      const session = await runTestMachine(result);
      expect(sessionToShorthand(session)).toContain(
        "<error>This action was interrupted by a newer message from the user, and may not have finished.</error>",
      );
    });

    // A sender that asks to interrupt does not wait for the next step: the
    // step in flight stops, and the message runs as the next turn.
    it("stops the step in flight and runs the message next when it interrupts", async () => {
      const result = await createActorAndTask({
        chunkSets: [writeFileChunks, finishChunks],
      });
      result.actor.start();

      await waitFor(
        result.actor,
        (state) => state.context.agentRef !== undefined,
      );
      const agentRef = result.actor.getSnapshot().context.agentRef;
      if (!agentRef) {
        throw new Error("The agent never started");
      }
      await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));

      const messageId = StoreId.newMessageId();
      const message: SessionMessage.UserWithParts = {
        id: messageId,
        metadata: { createdAt: mockDate, sessionId: defaultSessionId },
        parts: [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId,
              sessionId: defaultSessionId,
            },
            text: "Make it about a submarine captain instead.",
            type: "text",
          },
        ],
        role: "user",
      };
      result.actor.send({
        interrupt: true,
        model: createMockAIGatewayModel(),
        type: "addMessage",
        value: message,
      });

      const session = await runTestMachine(result);
      expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
        "<session title="Test session" count="6">
          <user>
            <text>Hello, I need help with something.</text>
          </user>
          <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
            <step-start step="1" />
            <tool tool="write_file" state="output-error" callId="test-call-2">
              <input>
                {
                  "filePath": "test.txt",
                  "content": "console.log('Hello, world!');"
                }
              </input>
              <error>This action was interrupted by a newer message from the user, and may not have finished.</error>
            </tool>
          </assistant>
          <session-context instrument realRole="system" />
          <session-context instrument realRole="user" />
          <user>
            <text>Make it about a submarine captain instead.</text>
          </user>
          <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
            <step-start step="1" />
            <text state="done">I'm done.</text>
          </assistant>
        </session>"
      `);
    });

    // The sender's model is the one the next turn runs on, so a task the
    // chat messages after the user switched models moves with the picker.
    it("runs the message's turn on the model it was sent with", async () => {
      const result = await createActorAndTask({
        chunkSets: [writeFileChunks, finishChunks],
      });
      result.actor.start();

      await waitFor(
        result.actor,
        (state) => state.context.agentRef !== undefined,
      );
      const agentRef = result.actor.getSnapshot().context.agentRef;
      if (!agentRef) {
        throw new Error("The agent never started");
      }
      await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));

      const messageId = StoreId.newMessageId();
      result.actor.send({
        interrupt: true,
        model: createMockAIGatewayModel({ canonicalId: "switched-model-id" }),
        type: "addMessage",
        value: {
          id: messageId,
          metadata: { createdAt: mockDate, sessionId: defaultSessionId },
          parts: [
            {
              metadata: {
                createdAt: mockDate,
                id: StoreId.newPartId(),
                messageId,
                sessionId: defaultSessionId,
              },
              text: "Carry on.",
              type: "text",
            },
          ],
          role: "user",
        },
      });

      const session = await runTestMachine(result);
      expect(
        sessionToShorthand(session)
          .split("\n")
          .filter((line) => /<assistant |data-modelChange/.test(line))
          .map((line) => line.trim()),
      ).toMatchInlineSnapshot(`
        [
          "<assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">",
          "<data-modelChange from="mock-model-id" to="switched-model-id" />",
          "<assistant finishReason="stop" tokens="13" model="switched-model-id" provider="instrument">",
        ]
      `);
    });

    // A message sent while the agent is inside a tool call is written into
    // the transcript at the next point between steps and seen by the request
    // that follows, and once heard it is not run again as a turn of its own.
    it.each([{ saved: false }, { saved: true }])(
      "hears a message that arrives mid-turn at the next step, once (saved: $saved)",
      async ({ saved }) => {
        const result = await createActorAndTask({
          chunkSets: [writeFileChunks, finishChunks],
        });
        result.actor.start();

        await waitFor(
          result.actor,
          (state) => state.context.agentRef !== undefined,
        );
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          throw new Error("The agent never started");
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));

        const steerId = StoreId.newMessageId();
        const steer: SessionMessage.UserWithParts = {
          id: steerId,
          metadata: { createdAt: mockDate, sessionId: defaultSessionId },
          parts: [
            {
              metadata: {
                createdAt: mockDate,
                id: StoreId.newPartId(),
                messageId: steerId,
                sessionId: defaultSessionId,
              },
              text: "Make it about a submarine captain instead.",
              type: "text",
            },
          ],
          role: "user",
        };
        if (saved) {
          await ChatWrites.saveMessageWithParts(steer, result.chatId);
        }
        result.actor.send({
          model: createMockAIGatewayModel(),
          saved,
          type: "addMessage",
          value: steer,
        });

        const session = await runTestMachine(result);
        expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
          "<session title="Test session" count="6">
            <user>
              <text>Hello, I need help with something.</text>
            </user>
            <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
              <step-start step="1" />
              <tool tool="write_file" state="output-available" callId="test-call-2">
                <input>
                  {
                    "filePath": "test.txt",
                    "content": "console.log('Hello, world!');"
                  }
                </input>
                <output>
                  {
                    "content": "console.log('Hello, world!');",
                    "filePath": "test.js",
                    "isNewFile": false
                  }
                </output>
              </tool>
            </assistant>
            <session-context instrument realRole="system" />
            <session-context instrument realRole="user" />
            <user>
              <text>Make it about a submarine captain instead.</text>
            </user>
            <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
              <step-start step="2" />
              <text state="done">I'm done.</text>
            </assistant>
          </session>"
        `);
      },
    );
    describe("a message typed into a chat's working turn", () => {
      function typed(text: string): SessionMessage.UserWithParts {
        const messageId = StoreId.newMessageId();
        return {
          id: messageId,
          metadata: { createdAt: mockDate, sessionId: defaultSessionId },
          parts: [
            {
              metadata: {
                createdAt: mockDate,
                id: StoreId.newPartId(),
                messageId,
                sessionId: defaultSessionId,
              },
              text,
              type: "text",
            },
          ],
          role: "user",
        };
      }

      async function startChatTurn() {
        answersAsChat();
        const result = await createActorAndTask({
          chunkSets: [writeFileChunks, finishChunks],
        });
        result.actor.start();
        await waitFor(
          result.actor,
          (state) => state.context.agentRef !== undefined,
        );
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          throw new Error("The agent never started");
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));
        return result;
      }

      // Nothing in flight is cut: the call finishes, and the turn's next
      // step reads the message with a note that it arrived mid-turn.
      it("joins the turn at its next step, marked as sent mid-turn", async () => {
        const result = await startChatTurn();
        const message = typed("b/c it's for the release notes");
        await ChatWrites.saveMessageWithParts(message, result.chatId);
        result.actor.send({
          model: createMockAIGatewayModel(),
          saved: true,
          type: "addMessage",
          value: message,
        });

        const session = await runTestMachine(result);
        const shorthand = sessionToShorthand(session);
        expect(shorthand).not.toContain("interrupted by a newer message");
        expect(shorthand).toContain(
          "The user sent this while you were working on their last message.",
        );
        // One turn: the message is answered by the step after the call.
        expect(shorthand.match(/<session-context/g)).toHaveLength(2);
        expect(shorthand).toContain("I'm done.</text>");
      });

      // A foreground command would hold the message until it ended. It is
      // not cut either: it moves to the background, and the message is heard
      // at the step after.
      it("moves a running command to the background and hears the message next", async () => {
        answersAsChat();
        // A command that runs until the case ends it, so the turn can only
        // finish by moving it to the background. The shell's own commands
        // load from disk, which the mocked filesystem hides.
        let stopped = false;
        let finish = () => {};
        vi.spyOn(bashEnv, "createBashEnv").mockResolvedValue({
          exec: (_command, options) =>
            new Promise((resolve, reject) => {
              finish = () => {
                // Only the fields the bash tool reads.
                resolve({
                  exitCode: 0,
                  stderr: "",
                  stdout: "slept\n",
                } as Awaited<ReturnType<bashEnv.BashRunner["exec"]>>);
              };
              options?.signal?.addEventListener("abort", () => {
                stopped = true;
                reject(new Error("aborted"));
              });
            }),
        });
        const bashChunks = [
          { id: "test-call-bash", toolName: "bash", type: "tool-input-start" },
          {
            input: JSON.stringify({
              command: "sleep 5",
              explanation: "Waiting",
              yieldMs: 60_000,
            }),
            toolCallId: "test-call-bash",
            toolName: "bash",
            type: "tool-call",
          },
        ] as const satisfies LanguageModelV4StreamPart[];
        const result = await createActorAndTask({
          chunkSets: [bashChunks, finishChunks],
        });
        result.actor.start();
        await waitFor(
          result.actor,
          (state) => state.context.agentRef !== undefined,
        );
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          throw new Error("The agent never started");
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCalls"));
        // Past the bash call's start, so its wait is registered.
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.actor.send({
          model: createMockAIGatewayModel(),
          type: "addMessage",
          value: typed("also check the logs"),
        });

        try {
          const session = await runTestMachine(result);
          const shorthand = sessionToShorthand(session);
          expect(shorthand).not.toContain("interrupted by a newer message");
          expect(shorthand).toContain('"movedForMessageFrom": "user"');
          expect(shorthand).toContain('"processId": "bg_1"');
          expect(shorthand).toContain(
            "The user sent this while you were working on their last message.",
          );
          expect(shorthand.match(/<session-context/g)).toHaveLength(2);
          expect(
            listBackgroundProcesses(result.sessionId).map(
              (process) => process.status,
            ),
          ).toEqual(["running"]);
          // The turn is over and the command runs on to its own end.
          finish();
          await vi.waitFor(() => {
            expect(
              listBackgroundProcesses(result.sessionId).map(
                (process) => process.status,
              ),
            ).toEqual(["exited"]);
          });
          expect(stopped).toBe(false);
        } finally {
          await killSessionBackgroundProcesses(result.sessionId);
        }
      });

      // A typed "stop" is a message like any other: it joins the turn, and
      // the agent decides what it means.
      it("joins the turn when it says stop, which only the Stop button cuts off", async () => {
        const result = await startChatTurn();
        result.actor.send({
          model: createMockAIGatewayModel(),
          type: "addMessage",
          value: typed("stop"),
        });

        const session = await runTestMachine(result);
        const shorthand = sessionToShorthand(session);
        expect(shorthand).not.toContain(
          "<error>This action was interrupted by a newer message from the user, and may not have finished.</error>",
        );
        expect(shorthand).toContain("<data-intent>");
      });
    });
  });

  describe("running a turn over the stored session", () => {
    function createFailedAssistantMessage(): SessionMessage.AssistantWithParts {
      const messageId = StoreId.newMessageId();
      return {
        id: messageId,
        metadata: {
          createdAt: mockDate,
          error: {
            kind: "api-call",
            message: "Overloaded",
            name: "AI_APICallError",
            url: "https://example.com",
          },
          finishReason: "unknown",
          modelId: "mock-model-id",
          providerId: "instrument",
          sessionId: defaultSessionId,
        },
        parts: [
          {
            metadata: {
              createdAt: mockDate,
              id: StoreId.newPartId(),
              messageId,
              sessionId: defaultSessionId,
            },
            state: "done",
            text: "Let me start by",
            type: "text",
          },
        ],
        role: "assistant",
      };
    }

    it("answers the request the session already holds", async () => {
      const result = await createActorAndTask({
        chunkSets: [finishChunks],
        queuedMessages: [],
        runRequested: true,
      });
      await ChatWrites.saveMessageWithParts(
        defaultQueuedMessage,
        result.chatId,
      );
      await ChatWrites.saveMessageWithParts(
        createFailedAssistantMessage(),
        result.chatId,
      );

      const session = await runTestMachine(result);
      expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
        "<session title="Test session" count="5">
          <user>
            <text>Hello, I need help with something.</text>
          </user>
          <assistant finishReason="unknown" model="mock-model-id" provider="instrument" errorKind="api-call" errorMessage="Overloaded">
            <text state="done">Let me start by</text>
          </assistant>
          <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
            <step-start step="1" />
            <text state="done">I'm done.</text>
          </assistant>
          <session-context instrument realRole="system" />
          <session-context instrument realRole="user" />
        </session>"
      `);
    });

    it("leaves the attempt that failed out of the request", async () => {
      const prompts: LanguageModelV4CallOptions["prompt"][] = [];
      const result = await createActorAndTask({
        aiSDKModel: new MockLanguageModelV4({
          doStream: async ({ prompt }) => {
            prompts.push(prompt);
            return {
              rawCall: { rawPrompt: null, rawSettings: {} },
              stream: simulateReadableStream({
                chunks: [...finishChunks, streamFinishChunk],
              }),
            };
          },
        }),
        queuedMessages: [],
        runRequested: true,
      });
      await ChatWrites.saveMessageWithParts(
        defaultQueuedMessage,
        result.chatId,
      );
      await ChatWrites.saveMessageWithParts(
        createFailedAssistantMessage(),
        result.chatId,
      );

      await runTestMachine(result);
      expect(prompts.at(-1)?.map((message) => message.role))
        .toMatchInlineSnapshot(`
        [
          "system",
          "user",
          "user",
        ]
      `);
    });

    it("finishes without a turn when the session is empty", async () => {
      const session = await createAndRunTestMachine({
        queuedMessages: [],
        runRequested: true,
      });
      expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
        "<session title="Test session" count="0">

        </session>"
      `);
    });
  });

  it("should enforce max step count when set to 2", async () => {
    const session = await createAndRunTestMachine({
      chunkSets: [readFileChunks, readFileChunks, readFileChunks, finishChunks],
      maxStepCount: 2,
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="1" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <session-context instrument realRole="system" />
        <session-context instrument realRole="user" />
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <tool tool="read_file" state="output-available" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <output>
              {
                "content": "Hello, world!",
                "displayedLines": 1,
                "filePath": "./test.txt",
                "hasMoreLines": false,
                "offset": 1,
                "state": "exists",
                "totalLines": 1,
                "truncatedByBytes": false
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="max-steps" model="instrument-synthetic" provider="system">
          <data-maxSteps maxStepCount="2" />
        </assistant>
      </session>"
    `);
  });
});
