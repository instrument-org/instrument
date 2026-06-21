import type { ActorRefFrom } from "xstate";

import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { assign, fromPromise, log, setup } from "xstate";

import { type AgentName } from "../agents/types";
import { type AppConfig } from "../lib/app-config/types";
import { getCurrentDate } from "../lib/get-current-date";
import { runToolCall } from "../lib/run-tool-call";
import { type SpawnAgentFunction } from "../lib/spawn-agent";
import { Store } from "../lib/store";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { getToolByType } from "../tools/all";

type CancellationReason = "manual" | "timeout" | "unknown";

const executeToolLogic = fromPromise<
  { preliminarySaved: boolean },
  {
    agentName: AgentName;
    appConfig: AppConfig;
    model: AIGatewayModel.Type;
    part: SessionMessagePart.ToolPartInputAvailable;
    sessionId: StoreId.Session;
    spawnAgent: SpawnAgentFunction;
  }
>(
  async ({
    input: { agentName, appConfig, model, part, sessionId, spawnAgent },
    signal,
  }) => {
    return runToolCall({
      agentName,
      appConfig,
      model,
      part,
      sessionId,
      signal,
      spawnAgent,
    });
  },
);

export const executeToolCallMachine = setup({
  actors: {
    cancelToolCallLogic: fromPromise<
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
      void,
      {
        appConfig: AppConfig;
        part: SessionMessagePart.ToolPartInputAvailable;
        reason: CancellationReason;
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
        input.appConfig,
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
            appConfig: context.appConfig,
            input: context.part.input as never,
          })
        : tool.timeoutMs;
    },
  },

  types: {
    context: {} as {
      agentName: AgentName;
      appConfig: AppConfig;
      cancellationReason: CancellationReason;
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
    },
    events: {} as { type: "stop" },
    input: {} as {
      agentName: AgentName;
      appConfig: AppConfig;
      model: AIGatewayModel.Type;
      part: SessionMessagePart.ToolPartInputAvailable;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
    },
  },
}).createMachine({
  context: ({ input }) => ({
    agentName: input.agentName,
    appConfig: input.appConfig,
    cancellationReason: "unknown",
    model: input.model,
    part: input.part,
    sessionId: input.sessionId,
    spawnAgent: input.spawnAgent,
  }),
  id: "executeToolCall",
  initial: "Executing",
  states: {
    Cancelling: {
      invoke: {
        input: ({ context }) => ({
          appConfig: context.appConfig,
          part: context.part,
          reason: context.cancellationReason,
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
          appConfig: context.appConfig,
          model: context.model,
          part: context.part,
          sessionId: context.sessionId,
          spawnAgent: context.spawnAgent,
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
