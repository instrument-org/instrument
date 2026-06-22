import type { ActorRefFrom } from "xstate";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { assign, fromPromise, log, setup } from "xstate";

import { type AgentName } from "../agents/types";
import { getCurrentDate } from "../lib/get-current-date";
import { runToolCall } from "../lib/run-tool-call";
import { type SpawnAgentFunction } from "../lib/spawn-agent";
import { Store } from "../lib/store";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getToolByType } from "../tools/all";

type CancellationReason = "manual" | "timeout" | "unknown";

const executeToolLogic = fromPromise<
  { preliminarySaved: boolean },
  {
    agentName: AgentName;
    model: AIGatewayModel.Type;
    part: SessionMessagePart.ToolPartInputAvailable;
    sessionId: StoreId.Session;
    spawnAgent: SpawnAgentFunction;
    taskId: TaskId;
  }
>(
  async ({
    input: { agentName, model, part, sessionId, spawnAgent, taskId },
    signal,
  }) => {
    return runToolCall({
      agentName,
      model,
      part,
      sessionId,
      signal,
      spawnAgent,
      taskId,
    });
  },
);

export const executeToolCallMachine = setup({
  actors: {
    cancelToolCallLogic: fromPromise<
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
      void,
      {
        part: SessionMessagePart.ToolPartInputAvailable;
        reason: CancellationReason;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      await Store.updatePart(
        {
          messageId: input.part.metadata.messageId,
          partId: input.part.metadata.id,
          sessionId: input.part.metadata.sessionId,
        },
        (current) =>
          ({
            ...current,
            errorText: `This action was stopped${input.reason === "timeout" ? " because it took too long" : input.reason === "manual" ? " by you" : ""}.`,
            metadata: {
              ...current.metadata,
              endedAt: getCurrentDate(),
            },
            state: "output-error",
          }) as SessionMessagePart.Type,
        input.taskId,
        { signal },
      );
    }),

    executeToolLogic,
  },

  delays: {
    toolCallTimeout: ({ context }) => {
      const tool = getToolByType(context.part.type);
      return typeof tool.timeoutMs === "function"
        ? tool.timeoutMs({
            input: context.part.input as never,
            taskId: context.taskId,
          })
        : tool.timeoutMs;
    },
  },

  types: {
    context: {} as {
      agentName: AgentName;
      cancellationReason: CancellationReason;
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
      taskId: TaskId;
    },
    events: {} as { type: "stop" },
    input: {} as {
      agentName: AgentName;
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
      taskId: TaskId;
    },
  },
}).createMachine({
  context: ({ input }) => ({
    agentName: input.agentName,
    cancellationReason: "unknown",
    model: input.model,
    part: input.part,
    sessionId: input.sessionId,
    spawnAgent: input.spawnAgent,
    taskId: input.taskId,
  }),
  id: "executeToolCall",
  initial: "Executing",
  states: {
    Cancelling: {
      invoke: {
        input: ({ context }) => ({
          part: context.part,
          reason: context.cancellationReason,
          taskId: context.taskId,
        }),
        onDone: "Done",
        onError: { actions: log(({ event }) => event.error), target: "Done" },
        src: "cancelToolCallLogic",
      },
    },

    Done: { type: "final" },

    Executing: {
      after: {
        toolCallTimeout: {
          actions: assign({ cancellationReason: "timeout" }),
          target: "Cancelling",
        },
      },
      invoke: {
        input: ({ context }) => ({
          agentName: context.agentName,
          model: context.model,
          part: context.part,
          sessionId: context.sessionId,
          spawnAgent: context.spawnAgent,
          taskId: context.taskId,
        }),
        onDone: [
          {
            guard: ({ context, event }) =>
              context.cancellationReason !== "unknown" &&
              !event.output.preliminarySaved,
            target: "Cancelling",
          },
          { target: "Done" },
        ],
        onError: { actions: log(({ event }) => event.error), target: "Done" },
        src: "executeToolLogic",
      },
      on: {
        stop: {
          actions: assign({ cancellationReason: "manual" }),
          target: "Cancelling",
        },
      },
    },
  },
});

export type ExecuteToolCallActorRef = ActorRefFrom<
  typeof executeToolCallMachine
>;
