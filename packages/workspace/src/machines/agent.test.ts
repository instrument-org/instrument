import { noop } from "radashi";
import { describe, expect, it } from "vitest";
import { type AnyActorRef, createActor, fromPromise, waitFor } from "xstate";

import { mainAgent } from "../agents/main";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { agentMachine } from "./agent";
import { executeToolCallMachine } from "./execute-tool-call";

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
});
