import {
  type ImageModelV3,
  type LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { type AISDKWebSearchModelResult } from "@instrument-org/ai-gateway";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import mockFs from "mock-fs";
import { ok } from "neverthrow";
import path from "node:path";
import { pick } from "radashi";
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
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  waitFor,
} from "xstate";

import { setupAgent } from "../agents/create-agent";
import { mainAgent } from "../agents/main";
import { type AnyAgent } from "../agents/types";
import { Store } from "../lib/store";
import { publisher } from "../rpc/publisher";
import { type RelativePath } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { sessionToShorthand } from "../test/helpers/session-to-shorthand";
import { TOOLS } from "../tools/all";
import { sessionMachine, type SessionMachineParentEvent } from "./session";

vi.mock(import("ulid"));
vi.mock(import("../lib/session-store-storage"));
vi.mock(import("../lib/get-current-date"));
vi.mock(import("dugite"));
vi.mock(import("execa"), () => ({
  execa: vi.fn(),
}));

type Part =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer T>
    ? T
    : never;

describe("sessionMachine", () => {
  const taskFolder = "pj-test";
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
  ] as const satisfies LanguageModelV3StreamPart[];

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
  ] as const satisfies LanguageModelV3StreamPart[];

  const finishChunks = [
    { id: "1", type: "text-start" },
    { delta: "I'm done.", id: "1", type: "text-delta" },
    { id: "1", type: "text-end" },
    {
      finishReason: { raw: "stop", unified: "stop" },
      type: "finish",
      usage: mockUsage,
    },
  ] as const satisfies LanguageModelV3StreamPart[];

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
  ] as const satisfies LanguageModelV3StreamPart[];

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

  afterEach(() => {
    mockFs.restore();
    vi.restoreAllMocks();
  });

  async function createActorAndTask({
    agent = mainAgent,
    baseLLMRetryDelayMs = 1000,
    chunkDelayInMs = [],
    chunkSets = [],
    imageModel,
    initialChunkDelaysMs = [],
    llmRequestChunkTimeoutMs = 120_000,
    maxStepCount,
    providerConfigId = "mock-provider-config-id",
    queuedMessages = [defaultQueuedMessage],
    sessionId = defaultSessionId,
    webSearchModel,
  }: {
    agent?: AnyAgent;
    baseLLMRetryDelayMs?: number;
    chunkDelayInMs?: number[];
    chunkSets?: Part[][];
    imageModel?: ImageModelV3;
    initialChunkDelaysMs?: number[];
    llmRequestChunkTimeoutMs?: number;
    maxStepCount?: number;
    providerConfigId?: string;
    queuedMessages?: SessionMessage.UserWithParts[];
    sessionId?: StoreId.Session;
    webSearchModel?: AISDKWebSearchModelResult;
  }) {
    let currentChunkIndex = 0;
    const mockLanguageModel = new MockLanguageModelV3({
      // oxlint-disable-next-line typescript/require-await
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
            chunkDelayInMs: chunkDelayInMs[chunkIndex],
            chunks: [
              ...currentChunks,
              {
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
              },
            ],
            initialDelayInMs: initialChunkDelaysMs[chunkIndex],
          }),
        };
      },
    });

    // Provider config id defaults to the shared mock; the parallel-sessions
    // test passes distinct ids so each session resolves its own model override
    // via the workspace singleton.
    const model = createMockAIGatewayModel({ providerConfigId });

    const testTaskConfig = createMockTaskConfig(
      TaskIdSchema.parse(taskFolder),
      {
        aiSDKModel: mockLanguageModel,
        imageModel,
        model,
        webSearchModel,
      },
    );

    await Store.saveSession(
      {
        createdAt: mockDate,
        id: sessionId,
        title: "Test session",
      },
      testTaskConfig,
    );

    const actor = createActor(sessionMachine, {
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
              if (event.type === "session.spawnSubAgent") {
                // Create a session for the spawned agent and immediately complete it
                void (async () => {
                  await Store.saveSession(
                    {
                      createdAt: mockDate,
                      id: event.value.sessionId,
                      title: "Spawned session",
                    },
                    testTaskConfig,
                  );
                  await Store.saveMessageWithParts(
                    event.value.message,
                    testTaskConfig,
                  );
                  // Create a simple assistant response
                  const assistantMessageId = StoreId.newMessageId();
                  const responseMessage: SessionMessage.AssistantWithParts = {
                    id: assistantMessageId,
                    metadata: {
                      createdAt: mockDate,
                      finishReason: "stop",
                      modelId: model.canonicalId,
                      providerId: model.providerId,
                      sessionId: event.value.sessionId,
                    },
                    parts: [
                      {
                        metadata: {
                          createdAt: mockDate,
                          id: StoreId.newPartId(),
                          messageId: assistantMessageId,
                          sessionId: event.value.sessionId,
                        },
                        text: "Task completed",
                        type: "text",
                      },
                    ],
                    role: "assistant",
                  };
                  await Store.saveMessageWithParts(
                    responseMessage,
                    testTaskConfig,
                  );
                  publisher.publish("session.done", {
                    id: testTaskConfig,
                    parentSessionId: undefined,
                    sessionId: event.value.sessionId,
                  });
                })();
              } else if (event.value.error) {
                // eslint-disable-next-line no-console
                console.error("session.done error", event.value.error);
              }
            }),
        } as unknown as AnyActorRef,
        queuedMessages,
        sessionId,
        taskId: testTaskConfig,
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

    return { actor, sessionId, taskId: testTaskConfig };
  }

  async function runTestMachine({
    actor,
    sessionId,
    taskId,
  }: {
    actor: ActorRefFrom<typeof sessionMachine>;
    sessionId: StoreId.Session;
    taskId: TaskId;
  }) {
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    return Store.getSessionWithMessagesAndParts(sessionId, taskId);
  }

  async function createAndRunTestMachine(
    options: Parameters<typeof createActorAndTask>[0],
  ) {
    const result = await createActorAndTask(options);
    return runTestMachine(result);
  }

  beforeEach(() => {
    mockFs({
      [MOCK_WORKSPACE_DIRS.defaultTaskTemplate]: {
        "package.json": "{}",
      },
      [MOCK_WORKSPACE_DIRS.tasks]: {
        [taskFolder]: {
          "image.png": mockFs.load(
            path.resolve(
              import.meta.dirname,
              "../../fixtures/assets/image.png",
            ),
          ),
          "package.json": "{}",
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
          <data-fileChanges>
            <file filename="test.txt" status="modified" />
          </data-fileChanges>
        </assistant>
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
                "base64Data": "iVBORw0KGgoAAAANSUhEUgAAAGQAAABLAQMAAAC81rD0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABlBMVEUAAP7////DYP5JAAAAAWJLR0QB/wIt3gAAAAlwSFlzAAALEgAACxIB0t1+/AAAAAd0SU1FB+QIGBcKN7/nP/UAAAASSURBVDjLY2AYBaNgFIwCdAAABBoAAaNglfsAAAAZdEVYdGNvbW1lbnQAQ3JlYXRlZCB3aXRoIEdJTVDnr0DLAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDIwLTA4LTI0VDIzOjEwOjU1KzAzOjAwkHdeuQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyMC0wOC0yNFQyMzoxMDo1NSswMzowMOEq5gUAAAAASUVORK5CYII=",
                "filePath": "./image.png",
                "mimeType": "image/png",
                "state": "image"
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
    ] as const satisfies LanguageModelV3StreamPart[];

    const mockImageModel: ImageModelV3 = {
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
      specificationVersion: "v3",
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
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
          <data-fileChanges>
            <file filename="generated-image.png" status="added" />
          </data-fileChanges>
        </assistant>
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
    ] as const satisfies LanguageModelV3StreamPart[];

    const mockWebSearchModel = new MockLanguageModelV3({
      // oxlint-disable-next-line typescript/require-await
      doStream: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        stream: simulateReadableStream({
          chunks: [
            { id: "1", type: "text-start" },
            {
              delta: "TypeScript 5.7 introduces new features.",
              id: "1",
              type: "text-delta",
            },
            {
              id: "source-1",
              sourceType: "url",
              title: "TypeScript Blog",
              type: "source",
              url: "https://devblogs.microsoft.com/typescript",
            },
            { id: "1", type: "text-end" },
            {
              finishReason: { raw: "stop", unified: "stop" },
              type: "finish",
              usage: {
                inputTokens: {
                  cacheRead: undefined,
                  cacheWrite: undefined,
                  noCache: undefined,
                  total: 5,
                },
                outputTokens: {
                  reasoning: undefined,
                  text: undefined,
                  total: 15,
                },
              },
            },
          ] satisfies LanguageModelV3StreamPart[],
          initialDelayInMs: 0,
        }),
      }),
    });

    const session = await createAndRunTestMachine({
      chunkSets: [webSearchChunks, finishChunks],
      webSearchModel: {
        model: mockWebSearchModel,
      },
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
                "modelId": "mock-model-id",
                "provider": {
                  "id": "mock-provider-config-id",
                  "type": "instrument"
                },
                "sources": [
                  {
                    "title": "TypeScript Blog",
                    "url": "https://devblogs.microsoft.com/typescript"
                  }
                ],
                "state": "success",
                "text": "TypeScript 5.7 introduces new features.",
                "usage": {
                  "inputTokens": 5,
                  "outputTokens": 15,
                  "totalTokens": 20
                }
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
          <tool tool="read_file" state="output-error" callId="test-call-1">
            <input>
              {
                "filePath": "test.txt"
              }
            </input>
            <error>Model tried to call unavailable tool 'invalid_tool_name'. Available tools: edit_file, generate_image, glob, grep, load_skill, read_file, save_skill, bash, web_search, write_file.</error>
          </tool>
        </assistant>
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
      </session>"
    `);
  });

  it("should stop agents during llm request", async () => {
    const result = await createActorAndTask({
      chunkSets: [finishChunks],
    });
    result.actor.start();
    await waitFor(result.actor, (state) =>
      state.matches({ Agent: "UsingReadOnlyTools" }),
    );
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

  it("should force stop agents before the stopping failsafe completes", async () => {
    let finishOnFinish: (() => void) | undefined;
    const onFinishPromise = new Promise<void>((resolve) => {
      finishOnFinish = resolve;
    });
    const result = await createActorAndTask({
      agent: setupAgent({
        agentTools: pick(TOOLS, ["ReadFile"]),
        name: "main",
      }).create(() => ({
        getMessages: mainAgent.getMessages,
        onFinish: async () => {
          await onFinishPromise;
        },
        onStart: mainAgent.onStart,
        shouldContinue: mainAgent.shouldContinue,
      })),
      chunkSets: [finishChunks],
    });
    result.actor.start();

    await waitFor(result.actor, (state) =>
      state.matches({ Agent: "UsingReadOnlyTools" }),
    );
    const agentRef = result.actor.getSnapshot().context.agentRef;
    if (!agentRef) {
      throw new Error("Expected agent ref");
    }

    result.actor.send({ type: "stop" });
    await waitFor(result.actor, (state) => state.status === "done");

    const snapshot = result.actor.getSnapshot();
    expect(snapshot.hasTag("agent.alive")).toBe(false);
    expect(snapshot.context.agentRef).toBeUndefined();
    expect(agentRef.getSnapshot().status).toBe("stopped");

    finishOnFinish?.();
  });

  it("should handle interactive tool calls with choose tool", async () => {
    const result = await createActorAndTask({
      agent: setupAgent({
        agentTools: pick(TOOLS, ["Choose"]),
        name: "main",
      }).create(() => ({
        getMessages: mainAgent.getMessages,
        onFinish: mainAgent.onFinish,
        onStart: mainAgent.onStart,
        shouldContinue: mainAgent.shouldContinue,
      })),
      chunkSets: [chooseChunks, finishChunks],
    });

    result.actor.start();

    // Wait for the agent to reach the WaitingForPendingToolCalls state
    await waitFor(result.actor, (state) =>
      state.matches({ Agent: { UsingReadOnlyTools: "Paused" } }),
    );

    // Send the tool call update to simulate user selection
    result.actor.send({
      type: "updateInteractiveToolCall",
      value: {
        toolCallId: chooseToolCallId,
        type: "success",
        value: {
          output: { selectedChoice: "Continue" },
          toolName: "choose",
        },
      },
    });

    // Wait for the actor to complete
    await waitFor(result.actor, (state) => state.status === "done");

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
                "selectedChoice": "Continue"
              }
            </output>
          </tool>
        </assistant>
        <assistant finishReason="stop" tokens="13" model="mock-model-id" provider="instrument">
          <step-start step="2" />
          <text state="done">I'm done.</text>
        </assistant>
        <session-context main realRole="system" />
        <session-context main realRole="user" />
      </session>"
    `);
  });

  it("should retry and fail on timeout", async () => {
    const chunkTimeoutMs = 500;
    const session = await createAndRunTestMachine({
      baseLLMRetryDelayMs: 0,
      chunkSets: [readFileChunks, readFileChunks, readFileChunks, finishChunks],
      initialChunkDelaysMs: [chunkTimeoutMs * 2, chunkTimeoutMs * 2, 1, 1],
      llmRequestChunkTimeoutMs: chunkTimeoutMs,
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="7">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="aborted" model="mock-model-id" provider="instrument" errorKind="aborted" errorMessage="Aborted">
          <step-start step="1" />
        </assistant>
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
      </session>"
    `);
  });

  it("should extend timeout when chunks are received", async () => {
    const chunkTimeoutMs = 100;

    const session = await createAndRunTestMachine({
      baseLLMRetryDelayMs: 0,
      chunkDelayInMs: [
        chunkTimeoutMs * 2, // First attempt: should timeout (200ms > 100ms)
        chunkTimeoutMs * 0.1, // Second attempt: should succeed (10ms < 100ms)
        chunkTimeoutMs * 0.1, // Third attempt: should succeed (10ms < 100ms)
      ],
      chunkSets: [readFileChunks, readFileChunks, finishChunks],
      llmRequestChunkTimeoutMs: chunkTimeoutMs,
    });

    expect(sessionToShorthand(session)).toMatchInlineSnapshot(`
      "<session title="Test session" count="6">
        <user>
          <text>Hello, I need help with something.</text>
        </user>
        <assistant finishReason="aborted" model="mock-model-id" provider="instrument" errorKind="aborted" errorMessage="Aborted">
          <step-start step="1" />
          <tool tool="read_file" state="input-streaming" callId="test-call-1"></tool>
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
      </session>"
    `);
  });

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
          state.matches({ Agent: "UsingReadOnlyTools" }) &&
          state.context.agentRef?.getSnapshot().context.agent.name === "main",
      ).then(async () => {
        const agentRef = result.actor.getSnapshot().context.agentRef;
        if (!agentRef) {
          return;
        }
        await waitFor(agentRef, (state) => state.matches("ExecutingToolCall"));
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
            <tool tool="read_file" state="input-available" callId="test-call-1">
              <input>
                {
                  "filePath": "test.txt"
                }
              </input>
            </tool>
          </assistant>
          <session-context main realRole="system" />
          <session-context main realRole="user" />
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
        <session-context main realRole="system" />
        <session-context main realRole="user" />
        <assistant finishReason="max-steps" model="instrument-synthetic" provider="system">
          <data-maxSteps maxStepCount="2" />
        </assistant>
      </session>"
    `);
  });
});
