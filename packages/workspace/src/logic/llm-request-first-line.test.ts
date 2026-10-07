import { type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AnyActorRef, createActor, setup, waitFor } from "xstate";

import {
  type FirstLineStep,
  firstLineStepFor,
  TOOLS_OFF_NOTE,
} from "../lib/first-line";
import { Store } from "../lib/store";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { TOOLS } from "../tools/all";
import { llmRequestLogic } from "./llm-request";

vi.mock(import("ulid"));

vi.mock(import("../lib/session-store-storage"));

vi.mock(import("../lib/get-current-date"));

vi.mock(import("../lib/first-line"), async (importOriginal) => ({
  ...(await importOriginal()),
  firstLineStepFor: vi.fn(),
}));

describe("llmRequestLogic under a first-line mode", () => {
  const sessionId = StoreId.newSessionId();
  const mockDate = new Date("2013-08-31T12:00:00.000Z");
  const contextMessageId = StoreId.newMessageId();
  const context: SessionMessage.ContextWithParts[] = [
    {
      id: contextMessageId,
      metadata: {
        agentName: "main",
        createdAt: mockDate,
        realRole: "system",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: mockDate,
            id: StoreId.newPartId(),
            messageId: contextMessageId,
            sessionId,
          },
          text: "You are a helpful assistant.",
          type: "text",
        },
      ],
      role: "session-context",
    },
  ];

  beforeEach(() => {
    vi.mocked(firstLineStepFor).mockReset();
  });

  async function run(step: FirstLineStep, chunks: LanguageModelV4StreamPart[]) {
    vi.mocked(firstLineStepFor).mockResolvedValue(step);
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            chunks: [
              ...chunks,
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
          }),
        }),
      provider: OUR_PROVIDER_CONFIG.type,
    });
    const taskId = createMockTaskConfig(TaskIdSchema.parse("mock"), {
      aiSDKModel: model,
      model: createMockAIGatewayModel({ provider: OUR_PROVIDER_CONFIG.type }),
    });
    await Store.saveSession(
      { createdAt: mockDate, id: sessionId, title: "Test session" },
      taskId,
    );
    const saved: { state?: string; type: string }[] = [];
    const savePart = Store.savePart.bind(Store);
    vi.spyOn(Store, "savePart").mockImplementation((part, ...rest) => {
      saved.push({
        state: "state" in part ? part.state : undefined,
        type: part.type,
      });
      return savePart(part, ...rest);
    });
    const machine = setup({
      actors: { llmRequest: llmRequestLogic },
    }).createMachine({
      initial: "Start",
      states: {
        Done: { type: "final" },
        Start: {
          invoke: {
            input: () => ({
              agent: {
                agentTools: {},
                getMessages: () => Promise.resolve(context),
                getTools: () => Promise.resolve([TOOLS.ReadFile]),
                name: "instrument-one",
                onFinish: () => Promise.resolve(),
                onStart: () => Promise.resolve(),
                shouldContinue: () => Promise.resolve(false),
                systemPrompt: () => "You are a helpful assistant.",
              },
              model: createMockAIGatewayModel({
                provider: OUR_PROVIDER_CONFIG.type,
              }),
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the request only sends chunk notices to it
              self: { send: vi.fn() } as unknown as AnyActorRef,
              sessionId,
              stepCount: 1,
              taskId,
            }),
            onDone: "Done",
            src: "llmRequest",
          },
        },
      },
    });
    const actor = createActor(machine);
    actor.start();
    await waitFor(actor, (state) => state.status === "done");
    const session = (
      await Store.getSessionWithMessagesAndParts(sessionId, taskId)
    )._unsafeUnwrap();
    const reply = session.messages.findLast(
      (message) => message.role === "assistant",
    );
    vi.mocked(Store.savePart).mockRestore();
    return { call: model.doStreamCalls[0], reply, saved };
  }

  const readCall = (input: Record<string, unknown>) =>
    [
      { id: "call-1", toolName: "read_file", type: "tool-input-start" },
      {
        delta: JSON.stringify(input).slice(0, 30),
        id: "call-1",
        type: "tool-input-delta",
      },
      {
        delta: JSON.stringify(input).slice(30),
        id: "call-1",
        type: "tool-input-delta",
      },
      {
        input: JSON.stringify(input),
        toolCallId: "call-1",
        toolName: "read_file",
        type: "tool-call",
      },
    ] satisfies LanguageModelV4StreamPart[];

  it("shows the first call's say as text ahead of the call, before the call is done", async () => {
    const { reply, saved } = await run(
      { takesSay: true },
      readCall({
        say: "Checking the notes file for you.",
        filePath: "notes.txt",
      }),
    );
    expect(
      reply?.parts.map((part) =>
        part.type === "text" ? `text: ${part.text}` : part.type,
      ),
    ).toEqual([
      "step-start",
      "text: Checking the notes file for you.",
      "tool-read_file",
    ]);
    // The line is whole, and saved, while the call is still streaming.
    expect(
      saved.findIndex((part) => part.type === "text" && part.state === "done"),
    ).toBeLessThan(
      saved.findIndex(
        (part) =>
          part.type === "tool-read_file" && part.state === "input-available",
      ),
    );
  });

  it.each([
    ["the step takes no say", { takesSay: false }, []],
    [
      "the step already said something",
      { takesSay: true },
      [
        { id: "t", type: "text-start" },
        { delta: "Looking.", id: "t", type: "text-delta" },
        { id: "t", type: "text-end" },
      ],
    ],
  ] satisfies [string, FirstLineStep, LanguageModelV4StreamPart[]][])(
    "leaves a say alone when %s",
    async (_, step, before) => {
      const { reply } = await run(step, [
        ...before,
        ...readCall({ say: "Checking.", filePath: "notes.txt" }),
      ]);
      expect(
        reply?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text),
      ).toEqual(before.length > 0 ? ["Looking."] : []);
    },
  );

  it("sends tools-off's first step with every tool, no tool choice, and the note last", async () => {
    const { call } = await run(
      { note: TOOLS_OFF_NOTE, takesSay: false, toolChoice: "none" },
      [
        { id: "t", type: "text-start" },
        { delta: "On it.", id: "t", type: "text-delta" },
        { id: "t", type: "text-end" },
      ],
    );
    expect(call?.toolChoice).toEqual({ type: "none" });
    expect(call?.tools?.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(call?.prompt.at(-1)).toMatchObject({
      content: [{ text: TOOLS_OFF_NOTE, type: "text" }],
      role: "user",
    });
  });
});
