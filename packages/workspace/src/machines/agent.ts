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
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getToolByType, type ToolOutputByName } from "../tools/all";
import { type AnyAgentTool } from "../tools/types";
import {
  executeToolCallMachine,
  saveStoppedToolCallPart,
} from "./execute-tool-call";

export type AgentParentEvent =
  | {
      /**
       * Messages the agent took from the session's queue and wrote into the
       * transcript mid-turn, so the session does not run them again as turns
       * of their own once this one ends.
       */
      type: "agent.consumedSteer";
      value: { messageIds: StoreId.Message[] };
    }
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
  /**
   * A message that arrived while this turn runs. Held until the next point
   * between steps, then written into the transcript so the next request sees
   * it, the way a person interrupting a colleague is heard at the end of the
   * sentence rather than the end of the job.
   */
  | { type: "steer"; value: SessionMessage.UserWithParts }
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

    /**
     * A tool part of this run still in `input-*` when the run ends has no
     * writer left: the stream that saved it is gone, queued calls are never
     * re-executed on resume, and model-message conversion filters `input-*`
     * parts out entirely, so the part would sit unresolved in the transcript
     * forever and the resumed model would lose the record of having made the
     * call. That covers queued siblings of a stopped call, parts an aborted
     * stream saved before the machine left `LLMStreaming` (they reach no
     * context array), pending interactive calls, and parts left by an errored
     * stream attempt. `Finishing` runs this on the paths that can strand one,
     * after `onFinish`. A stop gives the whole of `Finishing` about a second
     * before the session force-stops this actor, and the two have different
     * stakes in that budget: skill changes are consumed as `onFinish` reads
     * them, so a run that misses it loses them, while a sweep that misses
     * leaves parts exactly as they were without it.
     */
    finalizeDanglingToolCalls: fromPromise<
      // oxlint-disable-next-line typescript/no-invalid-void-type
      void,
      {
        parentMessageId: StoreId.Message;
        sessionId: StoreId.Session;
        stopRequested: boolean;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      const messageIdsResult = await Store.getMessageIds(
        input.sessionId,
        input.taskId,
        { signal },
      );

      if (messageIdsResult.isErr()) {
        throw new Error(
          `Error loading message ids: ${JSON.stringify(messageIdsResult.error)}`,
        );
      }

      // Only this run's steps: messages created after the one that started the
      // run (ids are monotonic ULIDs, so id order is creation order). A part
      // left dangling by an earlier run keeps whatever record that run wrote,
      // and reading those messages' parts alone keeps a finish off the rest of
      // the session, which a long one makes expensive to parse.
      const runMessageIds = messageIdsResult.value.filter(
        (messageId) => messageId > input.parentMessageId,
      );

      const partsResults = await Promise.all(
        runMessageIds.map((messageId) =>
          Store.getParts(input.sessionId, messageId, input.taskId, { signal }),
        ),
      );

      const danglingParts: SessionMessagePart.ToolPart[] = [];
      for (const partsResult of partsResults) {
        if (partsResult.isErr()) {
          throw new Error(
            `Error loading parts: ${JSON.stringify(partsResult.error)}`,
          );
        }
        for (const part of partsResult.value) {
          if (
            isToolPart(part) &&
            (part.state === "input-available" ||
              part.state === "input-streaming")
          ) {
            danglingParts.push(part);
          }
        }
      }

      // Written together so a run holding several of them costs about one
      // write, which is what keeps the sweep inside a stop's deadline.
      await Promise.all(
        danglingParts.map((part) =>
          saveStoppedToolCallPart(
            {
              part,
              reason: input.stopRequested ? "manual" : "unknown",
              taskId: input.taskId,
            },
            { signal },
          ),
        ),
      );
    }),

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

    /**
     * Writes the messages that arrived mid-turn into the transcript, in the
     * order they came, and answers with their ids. The request that follows
     * reads the whole transcript, so nothing else has to carry them.
     */
    saveSteeringMessages: fromPromise<
      StoreId.Message[],
      { messages: SessionMessage.UserWithParts[]; taskId: TaskId }
    >(async ({ input, signal }) => {
      const ids: StoreId.Message[] = [];
      for (const message of input.messages) {
        const saved = await Store.saveMessageWithParts(message, input.taskId, {
          signal,
        });
        if (saved.isErr()) {
          throw new Error(saved.error.message);
        }
        ids.push(saved.value.id);
      }
      return ids;
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
      maxAttemptCount: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentMessageId: StoreId.Message;
      parentRef: ParentActorRef;
      pendingToolCalls: SessionMessagePart.ToolPartInputAvailable[];
      retryCount: number;
      sessionId: StoreId.Session;
      spawnAgent: SpawnAgentFunction;
      /** Messages waiting for the next point between steps; see `steer`. */
      steeringMessages: SessionMessage.UserWithParts[];
      stepCount: number;
      stopRequested: boolean;
      taskId: TaskId;
      toolCallQueue: SessionMessagePart.ToolPartInputAvailable[];
      toolChoice?: "auto" | "none" | "required";
      // Streams whose tool parts no queue has taken over: raised when a
      // request starts and lowered when that request's own end hands its parts
      // to the queues, so an attempt the machine walked away from stays
      // counted for the rest of the run.
      unaccountedStreamCount: number;
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
    maxAttemptCount: 3,
    maxStepCount: input.maxStepCount || 1,
    model: input.model,
    parentMessageId: input.parentMessageId,
    parentRef: input.parentRef,
    pendingToolCalls: [],
    retryCount: 0,
    sessionId: input.sessionId,
    spawnAgent: input.spawnAgent,
    steeringMessages: [],
    stepCount: 0,
    stopRequested: false,
    taskId: input.taskId,
    toolCallQueue: [],
    toolChoice: input.toolChoice,
    unaccountedStreamCount: 0,
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
    steer: {
      actions: assign({
        steeringMessages: ({ context, event }) => [
          ...context.steeringMessages,
          event.value,
        ],
      }),
    },
    stop: {
      // Recorded so the finalizing sweep can tell a user stop (parts get the
      // "stopped by you" copy) from an error-driven finish.
      actions: assign({ stopRequested: true }),
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
      initial: "RunningOnFinish",
      states: {
        FinalizingDanglingToolCalls: {
          invoke: {
            input: ({ context }) => ({
              parentMessageId: context.parentMessageId,
              sessionId: context.sessionId,
              stopRequested: context.stopRequested,
              taskId: context.taskId,
            }),
            onDone: "#agent.Done",
            onError: { actions: "assignEventError", target: "#agent.Done" },
            src: "finalizeDanglingToolCalls",
          },
        },
        MaybeFinalizingDanglingToolCalls: {
          always: [
            {
              // Every stream of this run handed its tool parts to the queues,
              // both queues are drained, and no stop cut a call short, so
              // nothing of this run is left in `input-*` and the sweep would
              // buy the turn nothing for the read it costs.
              guard: ({ context }) =>
                context.unaccountedStreamCount === 0 &&
                !context.stopRequested &&
                context.pendingToolCalls.length === 0 &&
                context.toolCallQueue.length === 0,
              target: "#agent.Done",
            },
            { target: "FinalizingDanglingToolCalls" },
          ],
        },
        RunningOnFinish: {
          invoke: {
            input: ({ context }) => ({
              agent: context.agent,
              model: context.model,
              parentMessageId: context.parentMessageId,
              sessionId: context.sessionId,
              taskId: context.taskId,
            }),
            onDone: "MaybeFinalizingDanglingToolCalls",
            onError: {
              actions: "assignEventError",
              target: "MaybeFinalizingDanglingToolCalls",
            },
            src: "onFinish",
          },
        },
      },
    },

    LLMStreaming: {
      entry: assign({
        unaccountedStreamCount: ({ context }) =>
          context.unaccountedStreamCount + 1,
      }),
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
            assign(({ context, event: { output } }) => {
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

              return {
                pendingToolCalls,
                toolCallQueue,
                unaccountedStreamCount: context.unaccountedStreamCount - 1,
              };
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
              // The initial request spends one of the attempts, and XState runs
              // guards before the transition's actions, so `retryCount` is
              // still the number of retries already made.
              const attemptsSoFar = context.retryCount + 1;
              return attemptsSoFar < context.maxAttemptCount;
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

    /**
     * The point between steps where a message that arrived mid-turn is heard.
     * Every tool call of the step is done and nothing is pending, so a user
     * message written here lands after the results it should follow, and the
     * next request is the first to see it. A message that arrives after this
     * check is either heard at the next step or, when the turn ends first,
     * run by the session as a turn of its own.
     */
    MaybeSteering: {
      always: [
        {
          guard: ({ context }) => context.steeringMessages.length > 0,
          target: "SavingSteeringMessages",
        },
        { target: "MaybeContinuing" },
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
          target: "MaybeSteering",
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

    /**
     * The saved messages are a new request, so the loop goes straight to the
     * model rather than asking whether the last reply left anything to do.
     */
    SavingSteeringMessages: {
      invoke: {
        input: ({ context }) => ({
          messages: context.steeringMessages,
          taskId: context.taskId,
        }),
        onDone: {
          actions: [
            ({ context, event }) => {
              context.parentRef.send({
                type: "agent.consumedSteer",
                value: { messageIds: event.output },
              });
            },
            assign({ steeringMessages: [] }),
          ],
          target: "MaybeStartingLLMRequest",
        },
        onError: {
          actions: "assignEventError",
          target: "Finishing",
        },
        src: "saveSteeringMessages",
      },
    },

    WaitingForPendingToolCalls: {
      always: {
        guard: ({ context }) => {
          return context.pendingToolCalls.length === 0;
        },
        target: "MaybeSteering",
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
