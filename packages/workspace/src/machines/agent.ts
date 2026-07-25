import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { SYNTHETIC_MODEL_ID } from "@instrument-org/shared";
import { type Result } from "neverthrow";
import invariant from "tiny-invariant";
import {
  type ActorRef,
  type ActorRefFrom,
  type AnyMachineSnapshot,
  assign,
  fromPromise,
  raise,
  sendTo,
  setup,
} from "xstate";

import { type AnyAgent } from "../agents/types";
import { createAssignEventError } from "../lib/assign-event-error";
import { getCurrentDate } from "../lib/get-current-date";
import { getErrorAction } from "../lib/get-error-action";
import { isInteractiveTool } from "../lib/is-interactive-tool";
import { isToolPart } from "../lib/is-tool-part";
import { logUnhandledEvent } from "../lib/log-unhandled-event";
import { type SpawnAgentFunction } from "../lib/spawn-agent";
import { Store } from "../lib/store";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { llmRequestLogic } from "../logic/llm-request";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getToolByType, type ToolOutputByName } from "../tools/all";
import { type AnyAgentTool } from "../tools/types";
import { executeToolCallMachine } from "./execute-tool-call";

export type AgentParentEvent =
  | {
      type: "agent.done";
      value: { error?: unknown };
    }
  | { type: "agent.paused" }
  | { type: "agent.resumed" }
  | {
      type: "agent.usingTool";
      value: AnyAgentTool;
    };

export type ToolCallUpdate =
  | { errorText: string; toolCallId: string; type: "error" }
  | {
      toolCallId: string;
      type: "success";
      value: ToolOutputByName;
    };

type AgentMachineEvent =
  | { error: Error; type: "error" }
  | { type: "executeToolCalls" }
  | { type: "llmRequest.chunkReceived" }
  | { type: "retry" }
  | { type: "stop" }
  | {
      type: "updateInteractiveToolCall";
      value: ToolCallUpdate;
    };

type AgentResult = Result<void, "agent-error:unknown">;

type ParentActorRef = ActorRef<AnyMachineSnapshot, AgentParentEvent>;

export const agentMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),
  },

  actors: {
    executeToolCallMachine,

    llmRequestLogic,

    onFinish: fromPromise<
      // oxlint-disable-next-line typescript/no-invalid-void-type
      void,
      {
        agent: AnyAgent;
        model: AIGatewayModel.Type;
        parentMessageId: StoreId.Message;
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      await input.agent.onFinish({
        model: input.model,
        parentMessageId: input.parentMessageId,
        sessionId: input.sessionId,
        signal,
        taskId: input.taskId,
      });
    }),

    onStart: fromPromise<
      // oxlint-disable-next-line typescript/no-invalid-void-type
      void,
      {
        agent: AnyAgent;
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      return input.agent.onStart({
        sessionId: input.sessionId,
        signal,
        taskId: input.taskId,
      });
    }),

    saveMaxStepsMessage: fromPromise<
      // oxlint-disable-next-line typescript/no-invalid-void-type
      void,
      {
        maxStepCount: number;
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      const now = getCurrentDate();
      const messageId = StoreId.newMessageId();

      const result = await Store.saveMessageWithParts(
        {
          id: messageId,
          metadata: {
            createdAt: now,
            finishReason: "max-steps",
            modelId: SYNTHETIC_MODEL_ID,
            providerId: "system",
            sessionId: input.sessionId,
            synthetic: true,
          },
          // Hidden data part rather than assistant text: the "Resume the agent"
          // alert is the visible affordance, and the model gets a system note on
          // the next user turn (see `maxStepsModelNote`) instead of a line that
          // reads as its own words. `finishReason: "max-steps"` still drives the
          // UI resume prompt.
          parts: [
            {
              data: { maxStepCount: input.maxStepCount },
              metadata: {
                createdAt: now,
                id: StoreId.newPartId(),
                messageId,
                sessionId: input.sessionId,
              },
              type: "data-maxSteps",
            },
          ],
          role: "assistant",
        },
        input.taskId,
        { signal },
      );

      if (result.isErr()) {
        throw new Error(
          `Failed to save max steps message: ${JSON.stringify(result.error)}`,
        );
      }
    }),

    shouldContinue: fromPromise<
      boolean,
      {
        agent: AnyAgent;
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      const messageResults = await Store.getMessagesWithParts(
        {
          sessionId: input.sessionId,
          taskId: input.taskId,
        },
        { signal },
      );

      if (messageResults.isErr()) {
        throw new Error(
          `Error loading messages: ${JSON.stringify(messageResults.error)}`,
        );
      }

      return input.agent.shouldContinue({
        messages: messageResults.value,
      });
    }),
  },

  delays: {
    llmRequestChunkTimeoutMs: ({ context }) => context.llmRequestChunkTimeoutMs,
    retryBackoff: ({ context }) => {
      return context.baseLLMRetryDelayMs * Math.pow(2, context.retryCount - 1);
    },
  },

  types: {
    children: {} as { toolCall: "executeToolCallMachine" },
    context: {} as {
      agent: AnyAgent;
      baseLLMRetryDelayMs: number;
      error?: unknown;
      llmRequestChunkTimeoutMs: number;
      maxRetryCount: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentMessageId: StoreId.Message;
      parentRef: ParentActorRef;
      pendingToolCalls: SessionMessagePart.ToolPartInputAvailable[];
      retryCount: number;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
      stepCount: number;
      stopRequested: boolean;
      taskId: TaskId;
      toolCallQueue: SessionMessagePart.ToolPartInputAvailable[];
      toolChoice?: "auto" | "none" | "required";
    },
    events: {} as AgentMachineEvent,
    input: {} as {
      agent: AnyAgent;
      baseLLMRetryDelayMs: number;
      llmRequestChunkTimeoutMs: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentMessageId: StoreId.Message;
      parentRef: ParentActorRef;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
      taskId: TaskId;
      toolChoice?: "auto" | "none" | "required";
    },
    output: {} as AgentResult,
  },
}).createMachine({
  context: ({ input }) => ({
    agent: input.agent,
    baseLLMRetryDelayMs: input.baseLLMRetryDelayMs,
    llmRequestChunkTimeoutMs: input.llmRequestChunkTimeoutMs,
    maxRetryCount: 3,
    maxStepCount: input.maxStepCount || 1,
    model: input.model,
    parentMessageId: input.parentMessageId,
    parentRef: input.parentRef,
    pendingToolCalls: [],
    retryCount: 0,
    sessionId: input.sessionId,
    spawnAgent: input.spawnAgent,
    stepCount: 0,
    stopRequested: false,
    taskId: input.taskId,
    toolCallQueue: [],
    toolChoice: input.toolChoice,
  }),
  id: "agent",
  initial: "Starting",
  on: {
    "*": {
      actions: ({ event, self }) => {
        logUnhandledEvent({
          captureException: getWorkspaceConfig().captureException,
          event,
          self,
        });
      },
    },
    error: {
      target: ".Finishing",
    },
    stop: {
      target: ".Finishing",
    },
    updateInteractiveToolCall: {
      actions: assign({
        pendingToolCalls: ({ context, event: { value } }) => {
          // TODO Only allow one match and use our ids
          const pendingToolCalls = context.pendingToolCalls.filter(
            (call) => call.toolCallId === value.toolCallId,
          );
          for (const pendingToolCall of pendingToolCalls) {
            // TODO Save these promises and handle them async in the state machine
            void Store.updatePart(
              {
                messageId: pendingToolCall.metadata.messageId,
                partId: pendingToolCall.metadata.id,
                sessionId: pendingToolCall.metadata.sessionId,
              },
              (current) =>
                (value.type === "success"
                  ? {
                      ...current,
                      metadata: {
                        ...current.metadata,
                        endedAt: new Date(),
                      },
                      output: value.value.output as never,
                      state: "output-available",
                    }
                  : {
                      ...current,
                      errorText: value.errorText,
                      metadata: {
                        ...current.metadata,
                        endedAt: new Date(),
                      },
                      state: "output-error",
                    }) as SessionMessagePart.Type,
              context.taskId,
            );
          }
          return context.pendingToolCalls.filter(
            (call) => call.toolCallId !== value.toolCallId,
          );
        },
      }),
    },
  },
  states: {
    Done: {
      // Note: We could use type: "done" here, but we don't want to trigger
      // the XState "done" event when the agent is stopped, which logs a warning.
      entry: ({ context }) => {
        context.parentRef.send({
          type: "agent.done",
          value: { error: context.error },
        });
      },
    },

    ExecutingToolCall: {
      invoke: {
        id: "toolCall",
        input: ({ context }) => {
          const [nextToolCall] = context.toolCallQueue;
          invariant(nextToolCall, "No tool call to execute");
          const tool = getToolByType(nextToolCall.type);
          context.parentRef.send({
            type: "agent.usingTool",
            value: tool,
          });
          return {
            agentName: context.agent.name,
            model: context.model,
            part: nextToolCall,
            sessionId: context.sessionId,
            spawnAgent: context.spawnAgent,
            taskId: context.taskId,
          };
        },
        onDone: {
          actions: assign({
            // Note: If we ever allow parallel tool calls, we'll need to filter
            // by id instead of just removing the first item.
            toolCallQueue: ({ context }) => {
              const [_, ...remainingQueue] = context.toolCallQueue;
              return remainingQueue;
            },
          }),
          target: "MaybeExecutingToolCalls",
        },
        onError: {
          actions: "assignEventError",
          target: "MaybeExecutingToolCalls",
        },
        src: "executeToolCallMachine",
      },
      on: {
        // Handled here instead of falling through to the machine-level `stop`:
        // leaving this state hard-stops the invoked child, which skips its own
        // `stop` handler and leaves the tool part stuck in `input-available`.
        // Staying put lets the child write its "stopped by you" part first, and
        // `MaybeExecutingToolCalls` routes to `Finishing` once it is done.
        stop: {
          actions: [
            assign({ stopRequested: true }),
            sendTo("toolCall", { type: "stop" }),
          ],
        },
      },
    },

    Finishing: {
      invoke: {
        input: ({ context }) => ({
          agent: context.agent,
          model: context.model,
          parentMessageId: context.parentMessageId,
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: "Done",
        onError: { actions: "assignEventError", target: "Done" },
        src: "onFinish",
      },
    },

    LLMStreaming: {
      initial: "PendingTimeout",
      invoke: {
        input: ({ context, self }) => {
          return {
            agent: context.agent,
            model: context.model,
            self,
            sessionId: context.sessionId,
            stepCount: context.stepCount,
            taskId: context.taskId,
            toolChoice: context.toolChoice,
          };
        },
        onDone: {
          actions: [
            raise(({ event: { output } }) => {
              const { message } = output;

              const errorAction = getErrorAction(message);
              if (errorAction.type !== "continue") {
                return errorAction;
              }

              return { type: "executeToolCalls" };
            }),
            assign(({ event: { output } }) => {
              const { message, parts } = output;
              if (getErrorAction(message).type !== "continue") {
                return {};
              }

              const pendingToolCalls: SessionMessagePart.ToolPartInputAvailable[] =
                [];
              const toolCallQueue: SessionMessagePart.ToolPartInputAvailable[] =
                [];

              for (const part of parts) {
                if (!isToolPart(part)) {
                  continue;
                }

                if (part.state !== "input-available") {
                  continue;
                }

                const tool = getToolByType(part.type);

                if (isInteractiveTool(tool.name)) {
                  pendingToolCalls.push(part);
                  continue;
                }

                // Add to queue for sequential execution
                toolCallQueue.push(part);
              }

              return { pendingToolCalls, toolCallQueue };
            }),
          ],
        },
        onError: { actions: "assignEventError", target: "Finishing" },
        src: "llmRequestLogic",
      },
      on: {
        executeToolCalls: {
          actions: assign({ retryCount: 0 }),
          target: "MaybeExecutingToolCalls",
        },
        retry: [
          {
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
            }),
            guard: ({ context }) => {
              return context.retryCount + 1 < context.maxRetryCount;
            },
            target: "RetryingWithDelay",
          },
          {
            target: "Finishing",
          },
        ],
      },
      states: {
        PendingTimeout: {
          after: {
            llmRequestChunkTimeoutMs: {
              actions: raise({ type: "retry" }),
            },
          },
          on: {
            "llmRequest.chunkReceived": "ResettingTimeout",
          },
        },
        ResettingTimeout: {
          always: "PendingTimeout",
        },
      },
    },

    MaybeContinuing: {
      invoke: {
        input: ({ context }) => ({
          agent: context.agent,
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: [
          {
            guard: ({ event: { output } }) => {
              return output;
            },
            target: "MaybeStartingLLMRequest",
          },
          { target: "Finishing" },
        ],
        onError: {
          actions: "assignEventError",
          target: "Finishing",
        },
        src: "shouldContinue",
      },
    },

    MaybeExecutingToolCalls: {
      always: [
        {
          guard: ({ context }) => context.stopRequested,
          target: "Finishing",
        },
        {
          guard: ({ context }) => context.toolCallQueue.length > 0,
          target: "ExecutingToolCall",
        },
        {
          target: "MaybeWaitingForPendingToolCalls",
        },
      ],
    },

    MaybeStartingLLMRequest: {
      always: [
        {
          actions: assign({
            stepCount: ({ context }) => context.stepCount + 1,
          }),
          guard: ({ context }) => {
            return context.stepCount + 1 <= context.maxStepCount;
          },
          target: "LLMStreaming",
        },
        {
          target: "SavingMaxStepsMessage",
        },
      ],
    },

    MaybeWaitingForPendingToolCalls: {
      always: [
        {
          guard: ({ context }) => {
            return context.pendingToolCalls.length > 0;
          },
          target: "WaitingForPendingToolCalls",
        },
        {
          target: "MaybeContinuing",
        },
      ],
    },

    RetryingWithDelay: {
      after: {
        retryBackoff: {
          target: "LLMStreaming",
        },
      },
    },

    SavingMaxStepsMessage: {
      invoke: {
        input: ({ context }) => ({
          maxStepCount: context.maxStepCount,
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: "Finishing",
        onError: { actions: "assignEventError", target: "Finishing" },
        src: "saveMaxStepsMessage",
      },
    },

    Starting: {
      invoke: {
        input: ({ context }) => ({
          agent: context.agent,
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: "MaybeStartingLLMRequest",
        onError: { actions: "assignEventError", target: "Finishing" },
        src: "onStart",
      },
    },

    WaitingForPendingToolCalls: {
      always: {
        guard: ({ context }) => {
          return context.pendingToolCalls.length === 0;
        },
        target: "MaybeContinuing",
      },
      entry: ({ context }) => {
        context.parentRef.send({ type: "agent.paused" });
      },
      exit: ({ context }) => {
        context.parentRef.send({ type: "agent.resumed" });
      },
    },
  },
});

export type AgentMachineActorRef = ActorRefFrom<typeof agentMachine>;
