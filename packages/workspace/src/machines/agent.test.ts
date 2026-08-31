import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";
import { type AnyActorRef, createActor, fromPromise, waitFor } from "xstate";

import { mainAgent } from "../agents/main";
import { isToolPart } from "../lib/is-tool-part";
import { Store } from "../lib/store";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { agentMachine } from "./agent";
import { executeToolCallMachine } from "./execute-tool-call";

vi.mock(import("../lib/session-store-storage"));

describe("agentMachine", () => {
  const model = createMockAIGatewayModel();
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"), { model });
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();
  const createdAt = new Date("2025-01-01T00:00:00.000Z");

  const assistantMessage: SessionMessage.Assistant = {
    id: messageId,
    metadata: {
      createdAt,
      finishReason: "tool-calls",
      modelId: model.canonicalId,
      providerId: model.params.provider,
      sessionId,
    },
    role: "assistant",
  };

  const parts: SessionMessagePart.Type[] = [
    {
      input: { explanation: "reading", filePath: "./test.txt" },
      metadata: { createdAt, id: StoreId.newPartId(), messageId, sessionId },
      state: "input-available",
      toolCallId: "test-call-1",
      type: "tool-read_file",
    },
  ];

  it("lets the running tool call cancel itself before finishing", async () => {
    let cancellationReason: string | undefined;

    const actor = createActor(
      agentMachine.provide({
        actors: {
          // The real child machine, with a tool execution that never settles so
          // the test can stop the agent mid-call, and a cancellation write that
          // records the reason instead of touching the store.
          executeToolCallMachine: executeToolCallMachine.provide({
            actors: {
              cancelToolCallLogic: fromPromise(({ input }) => {
                cancellationReason = input.reason;
                return Promise.resolve();
              }),
              executeToolLogic: fromPromise(
                () => new Promise<{ preliminarySaved: boolean }>(noop),
              ),
            },
          }),
          llmRequestLogic: fromPromise(() =>
            Promise.resolve({ message: assistantMessage, parts }),
          ),
          onFinish: fromPromise(() => Promise.resolve()),
          onStart: fromPromise(() => Promise.resolve()),
          shouldContinue: fromPromise(() => Promise.resolve(false)),
        },
      }),
      {
        input: {
          agent: mainAgent,
          baseLLMRetryDelayMs: 1,
          llmRequestChunkTimeoutMs: 120_000,
          maxStepCount: 1,
          model,
          parentMessageId: messageId,
          parentRef: { send: noop } as unknown as AnyActorRef,
          sessionId,
          spawnAgent: () => {
            throw new Error("Not expected");
          },
          taskId,
        },
      },
    );

    actor.start();
    await waitFor(actor, (state) => state.matches("ExecutingToolCall"));

    actor.send({ type: "stop" });
    await waitFor(actor, (state) => state.matches("Done"));

    expect(cancellationReason).toBe("manual");
  });

  function createAgentInput(ids: {
    parentMessageId: StoreId.Message;
    sessionId: StoreId.Session;
  }) {
    return {
      agent: mainAgent,
      baseLLMRetryDelayMs: 1,
      llmRequestChunkTimeoutMs: 120_000,
      maxStepCount: 1,
      model,
      parentRef: { send: noop } as unknown as AnyActorRef,
      spawnAgent: () => {
        throw new Error("Not expected");
      },
      taskId,
      ...ids,
    };
  }

  function createAssistantMessage(
    id: StoreId.Message,
    runSessionId: StoreId.Session,
  ): SessionMessage.Assistant {
    return {
      id,
      metadata: {
        createdAt,
        finishReason: "tool-calls",
        modelId: model.canonicalId,
        providerId: model.params.provider,
        sessionId: runSessionId,
      },
      role: "assistant",
    };
  }

  function createQueuedReadFilePart(
    n: number,
    ids: { messageId: StoreId.Message; sessionId: StoreId.Session },
  ): SessionMessagePart.Type {
    return {
      input: { explanation: "reading", filePath: `./file-${n}.txt` },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId: ids.messageId,
        sessionId: ids.sessionId,
      },
      state: "input-available",
      toolCallId: `call-${n}`,
      type: "tool-read_file",
    };
  }

  async function readToolParts(runSessionId: StoreId.Session) {
    const messagesResult = await Store.getMessagesWithParts({
      sessionId: runSessionId,
      taskId,
    });
    return messagesResult
      ._unsafeUnwrap()
      .flatMap((message) => message.parts.filter(isToolPart))
      .map((part) => ({
        errorText: part.state === "output-error" ? part.errorText : undefined,
        state: part.state,
        toolCallId: part.toolCallId,
      }));
  }

  it("finalizes queued sibling tool calls when the turn is stopped mid-queue", async () => {
    const runSessionId = StoreId.newSessionId();
    const parentMessageId = StoreId.newMessageId();
    const runMessage = createAssistantMessage(
      StoreId.newMessageId(),
      runSessionId,
    );
    const queuedParts = [1, 2, 3].map((n) =>
      createQueuedReadFilePart(n, {
        messageId: runMessage.id,
        sessionId: runSessionId,
      }),
    );

    const actor = createActor(
      agentMachine.provide({
        actors: {
          // The real child machine, with a tool execution that never settles so
          // the stop lands while call 1 runs and calls 2-3 are still queued.
          // Its cancellation write is the real one, which needs the parts in
          // the store; the llmRequestLogic stub saves them the way the real
          // stream does.
          executeToolCallMachine: executeToolCallMachine.provide({
            actors: {
              executeToolLogic: fromPromise(
                () => new Promise<{ preliminarySaved: boolean }>(noop),
              ),
            },
          }),
          llmRequestLogic: fromPromise(async () => {
            const savedResult = await Store.saveMessageWithParts(
              { ...runMessage, parts: queuedParts },
              taskId,
            );
            savedResult._unsafeUnwrap();
            return { message: runMessage, parts: queuedParts };
          }),
          onFinish: fromPromise(() => Promise.resolve()),
          onStart: fromPromise(() => Promise.resolve()),
          shouldContinue: fromPromise(() => Promise.resolve(false)),
        },
      }),
      { input: createAgentInput({ parentMessageId, sessionId: runSessionId }) },
    );

    actor.start();
    await waitFor(actor, (state) => state.matches("ExecutingToolCall"));

    actor.send({ type: "stop" });
    await waitFor(actor, (state) => state.matches("Done"));

    const toolParts = await readToolParts(runSessionId);
    expect(toolParts.filter((part) => part.state !== "output-error")).toEqual(
      [],
    );
    expect(toolParts).toMatchInlineSnapshot(`
      [
        {
          "errorText": "This action was stopped by you.",
          "state": "output-error",
          "toolCallId": "call-1",
        },
        {
          "errorText": "This action was stopped by you.",
          "state": "output-error",
          "toolCallId": "call-2",
        },
        {
          "errorText": "This action was stopped by you.",
          "state": "output-error",
          "toolCallId": "call-3",
        },
      ]
    `);
  });

  it("finalizes saved parts when the turn is stopped during input streaming", async () => {
    const runSessionId = StoreId.newSessionId();
    const parentMessageId = StoreId.newMessageId();
    const runMessage = createAssistantMessage(
      StoreId.newMessageId(),
      runSessionId,
    );
    const savedParts: SessionMessagePart.Type[] = [
      {
        input: undefined,
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: runMessage.id,
          sessionId: runSessionId,
        },
        state: "input-streaming",
        toolCallId: "call-streaming",
        type: "tool-read_file",
      },
      createQueuedReadFilePart(2, {
        messageId: runMessage.id,
        sessionId: runSessionId,
      }),
    ];

    let resolveSaved!: () => void;
    const saved = new Promise<void>((resolve) => {
      resolveSaved = resolve;
    });

    const actor = createActor(
      agentMachine.provide({
        actors: {
          // A stream that saves parts and never finishes, like a request the
          // stop cuts off mid-stream: the parts are in the store but reach no
          // context array, because the machine leaves LLMStreaming before the
          // invoke's onDone runs.
          llmRequestLogic: fromPromise(async () => {
            const savedResult = await Store.saveMessageWithParts(
              { ...runMessage, parts: savedParts },
              taskId,
            );
            savedResult._unsafeUnwrap();
            resolveSaved();
            return new Promise<{
              message: SessionMessage.Assistant;
              parts: SessionMessagePart.Type[];
            }>(noop);
          }),
          onFinish: fromPromise(() => Promise.resolve()),
          onStart: fromPromise(() => Promise.resolve()),
          shouldContinue: fromPromise(() => Promise.resolve(false)),
        },
      }),
      { input: createAgentInput({ parentMessageId, sessionId: runSessionId }) },
    );

    actor.start();
    await saved;

    actor.send({ type: "stop" });
    await waitFor(actor, (state) => state.matches("Done"));

    const toolParts = await readToolParts(runSessionId);
    expect(toolParts.filter((part) => part.state !== "output-error")).toEqual(
      [],
    );
    expect(toolParts).toMatchInlineSnapshot(`
      [
        {
          "errorText": "This action was stopped by you.",
          "state": "output-error",
          "toolCallId": "call-streaming",
        },
        {
          "errorText": "This action was stopped by you.",
          "state": "output-error",
          "toolCallId": "call-2",
        },
      ]
    `);
  });

  it("leaves finished and prior-run parts alone on a turn that ends without a stop", async () => {
    const runSessionId = StoreId.newSessionId();
    // A dangling part on a message from before this run: outside what the run
    // owns, so finishing must not rewrite it.
    const earlierMessage = createAssistantMessage(
      StoreId.newMessageId(),
      runSessionId,
    );
    const earlierDanglingPart = createQueuedReadFilePart(1, {
      messageId: earlierMessage.id,
      sessionId: runSessionId,
    });
    const parentMessageId = StoreId.newMessageId();
    const runMessage = createAssistantMessage(
      StoreId.newMessageId(),
      runSessionId,
    );
    const completedPart: SessionMessagePart.Type = {
      input: { command: "echo done", explanation: "echoing", timeoutMs: 1000 },
      metadata: {
        createdAt,
        endedAt: createdAt,
        id: StoreId.newPartId(),
        messageId: runMessage.id,
        sessionId: runSessionId,
      },
      output: {
        command: "echo done",
        commands: ["echo"],
        durationMs: 0,
        exitCode: 0,
        output: "done",
      },
      state: "output-available",
      toolCallId: "call-completed",
      type: "tool-bash",
    };
    const earlierParts: SessionMessagePart.Type[] = [earlierDanglingPart];
    const runParts: SessionMessagePart.Type[] = [completedPart];

    const actor = createActor(
      agentMachine.provide({
        actors: {
          llmRequestLogic: fromPromise(async () => {
            const earlierResult = await Store.saveMessageWithParts(
              { ...earlierMessage, parts: earlierParts },
              taskId,
            );
            earlierResult._unsafeUnwrap();
            const runResult = await Store.saveMessageWithParts(
              { ...runMessage, parts: runParts },
              taskId,
            );
            runResult._unsafeUnwrap();
            return { message: runMessage, parts: runParts };
          }),
          onFinish: fromPromise(() => Promise.resolve()),
          onStart: fromPromise(() => Promise.resolve()),
          shouldContinue: fromPromise(() => Promise.resolve(false)),
        },
      }),
      { input: createAgentInput({ parentMessageId, sessionId: runSessionId }) },
    );

    actor.start();
    await waitFor(actor, (state) => state.matches("Done"));

    expect(await readToolParts(runSessionId)).toMatchInlineSnapshot(`
      [
        {
          "errorText": undefined,
          "state": "input-available",
          "toolCallId": "call-1",
        },
        {
          "errorText": undefined,
          "state": "output-available",
          "toolCallId": "call-completed",
        },
      ]
    `);
  });
});
