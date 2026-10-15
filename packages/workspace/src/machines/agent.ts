import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { SYNTHETIC_MODEL_ID } from "@instrument-org/shared";
import { type Result } from "neverthrow";
import invariant from "tiny-invariant";
import {
  type ActorRef,
  type ActorRefFrom,
  type AnyMachineSnapshot,
  assign,
  type DoneActorEvent,
  enqueueActions,
  type ErrorActorEvent,
  fromPromise,
  raise,
  setup,
} from "xstate";

import { type AnyAgent } from "../agents/types";
import { createAssignEventError } from "../lib/assign-event-error";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { getCurrentDate } from "../lib/get-current-date";
import { getErrorAction } from "../lib/get-error-action";
import { isToolPart } from "../lib/is-tool-part";
import { logUnhandledEvent } from "../lib/log-unhandled-event";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { llmRequestLogic } from "../logic/llm-request";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getToolByType } from "../tools/all";
import {
  executeToolCallMachine,
  saveStoppedToolCallPart,
  type StopReason,
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
    };

/** A running tool call's child id, one per call so a batch can run at once. */
type ToolCallActorId = `toolCall:${string}`;

type AgentMachineEvent =
  // What a tool call's child sends as it finishes, listed here because the
  // children are spawned under ids made at runtime.
  | DoneActorEvent<unknown, ToolCallActorId>
  | ErrorActorEvent<unknown, ToolCallActorId>
  | { error: Error; type: "error" }
  /**
   * A message that arrived while this turn runs. Held until the next point
   * between steps, then written into the transcript so the next request sees
   * it, the way a person interrupting a colleague is heard at the end of the
   * sentence rather than the end of the job. `saved` when the sender already
   * wrote it to the store.
   */
  | { reason?: StopReason; type: "stop" }
  | { saved?: boolean; type: "steer"; value: SessionMessage.UserWithParts }
  | { type: "executeToolCalls" }
  | { type: "llmRequest.chunkReceived" }
  | { type: "retry" };

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
      void,
      {
        parentMessageId: StoreId.Message;
        sessionId: StoreId.Session;
        stopReason?: StopReason;
        chatId: ChatId;
      }
    >(async ({ input }) => {
      const messageIdsResult = await ChatReads.messageIds({
        chatId: input.chatId,
        sessionId: input.sessionId,
      });

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

      // A call still arriving is the turn's own memory rather than anything
      // written, so the read has to carry what the turn holds: the part this
      // sweep is here to finish is often one of those.
      const runMessages = await ChatReads.transcript({
        chatId: input.chatId,
        only: new Set(runMessageIds),
        sessionId: input.sessionId,
      });
      if (runMessages.isErr()) {
        throw new Error(
          `Error loading parts: ${JSON.stringify(runMessages.error)}`,
        );
      }

      const danglingParts: SessionMessagePart.ToolPart[] = [];
      for (const message of runMessages.value) {
        for (const part of message.parts) {
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
          saveStoppedToolCallPart({
            part,
            reason: input.stopReason ?? "unknown",
            chatId: input.chatId,
          }),
        ),
      );
    }),

    llmRequestLogic,

    onFinish: fromPromise<
      void,
      {
        agent: AnyAgent;
        model: AIGatewayModel.Type;
        parentMessageId: StoreId.Message;
        sessionId: StoreId.Session;
        chatId: ChatId;
      }
    >(async ({ input, signal }) => {
      await input.agent.onFinish({
        model: input.model,
        parentMessageId: input.parentMessageId,
        sessionId: input.sessionId,
        signal,
        chatId: input.chatId,
      });
    }),

    onStart: fromPromise<
      void,
      {
        agent: AnyAgent;
        sessionId: StoreId.Session;
        chatId: ChatId;
      }
    >(async ({ input, signal }) => {
      return input.agent.onStart({
        sessionId: input.sessionId,
        signal,
        chatId: input.chatId,
      });
    }),

    saveMaxStepsMessage: fromPromise<
      void,
      {
        maxStepCount: number;
        sessionId: StoreId.Session;
        chatId: ChatId;
      }
    >(async ({ input }) => {
      const now = getCurrentDate();
      const messageId = StoreId.newMessageId();

      const result = await ChatWrites.saveMessageWithParts(
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
        input.chatId,
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
      {
        messages: SessionMessage.UserWithParts[];
        savedIds: StoreId.Message[];
        chatId: ChatId;
      }
    >(async ({ input }) => {
      const ids: StoreId.Message[] = [];
      for (const message of input.messages) {
        if (input.savedIds.includes(message.id)) {
          ids.push(message.id);
          continue;
        }
        const saved = await ChatWrites.saveMessageWithParts(
          message,
          input.chatId,
        );
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
        chatId: ChatId;
      }
    >(async ({ input }) => {
      const messageResults = await ChatReads.modelHistory({
        chatId: input.chatId,
        sessionId: input.sessionId,
      });

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
      /** The request in flight went past its chunk timeout, which lets it go; cleared as each starts. */
      requestTimedOut: boolean;
      retryCount: number;
      /** Children of `ExecutingToolCalls` that have not finished yet. */
      runningToolCallActorIds: ToolCallActorId[];
      /** Steering messages the sender wrote to the store on arrival. */
      savedSteerIds: StoreId.Message[];
      sessionId: StoreId.Session;
      /** Messages waiting for the next point between steps; see `steer`. */
      steeringMessages: SessionMessage.UserWithParts[];
      stepCount: number;
      /** Set when a stop, rather than an error or the end of the turn, ends the run. */
      stopReason?: StopReason;
      chatId: ChatId;
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
      chatId: ChatId;
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
    requestTimedOut: false,
    retryCount: 0,
    runningToolCallActorIds: [],
    savedSteerIds: [],
    sessionId: input.sessionId,
    steeringMessages: [],
    stepCount: 0,
    chatId: input.chatId,
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
        savedSteerIds: ({ context, event }) =>
          event.saved
            ? [...context.savedSteerIds, event.value.id]
            : context.savedSteerIds,
        steeringMessages: ({ context, event }) => [
          ...context.steeringMessages,
          event.value,
        ],
      }),
    },
    stop: {
      // Recorded so the finalizing sweep can say why each part it closes
      // stopped: by the user, by a newer message superseding the reply, or,
      // with no reason, by an error-driven finish.
      actions: assign({
        stopReason: ({ event }) => event.reason ?? "manual",
      }),
      target: ".Finishing",
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

    /**
     * Runs the batch at the head of the queue: a run of consecutive read-only
     * calls all at once, or the single call there that can change something.
     * Read-only calls cannot affect each other, so the model's eight searches
     * take as long as the slowest one rather than all eight end to end, while
     * a write still runs alone, after everything the model asked for before
     * it and before everything after.
     *
     * Each call is a child of its own, so a stop or a timeout reaches every
     * call in flight and each writes its own stopped part.
     */
    ExecutingToolCalls: {
      always: {
        guard: ({ context }) => context.runningToolCallActorIds.length === 0,
        target: "MaybeExecutingToolCalls",
      },
      entry: enqueueActions(({ context, enqueue }) => {
        const batch = nextToolCallBatch(context.toolCallQueue);
        for (const part of batch) {
          enqueue.spawnChild("executeToolCallMachine", {
            id: toolCallActorId(part),
            input: {
              model: context.model,
              part,
              sessionId: context.sessionId,
              chatId: context.chatId,
            },
          });
        }
        enqueue.assign({
          runningToolCallActorIds: batch.map(toolCallActorId),
        });
      }),
      // Only a machine-level transition (an error) leaves with calls still
      // running; a stop waits here for every call to write its own record.
      exit: enqueueActions(({ context, enqueue }) => {
        for (const id of context.runningToolCallActorIds) {
          enqueue.stopChild(id);
        }
        enqueue.assign({ runningToolCallActorIds: [] });
      }),
      on: {
        // Handled here instead of falling through to the machine-level `stop`:
        // leaving this state hard-stops the children, which skips their own
        // `stop` handlers and leaves the tool parts stuck in `input-available`.
        // Staying put lets each child write its own stopped part first, and
        // `MaybeExecutingToolCalls` routes to `Finishing` once they are done.
        stop: {
          actions: enqueueActions(({ context, enqueue, event }) => {
            enqueue.assign({ stopReason: event.reason ?? "manual" });
            for (const id of context.runningToolCallActorIds) {
              enqueue.sendTo(id, { reason: event.reason, type: "stop" });
            }
          }),
        },
        "xstate.done.actor.*": {
          actions: assign(({ context, event }) =>
            withoutFinishedToolCall(context, event.actorId),
          ),
        },
        "xstate.error.actor.*": {
          actions: [
            "assignEventError",
            assign(({ context, event }) =>
              withoutFinishedToolCall(context, event.actorId),
            ),
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
              stopReason: context.stopReason,
              chatId: context.chatId,
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
                context.stopReason === undefined &&
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
              chatId: context.chatId,
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
        requestTimedOut: false,
        unaccountedStreamCount: ({ context }) =>
          context.unaccountedStreamCount + 1,
      }),
      initial: "PendingTimeout",
      invoke: {
        input: ({ context, self }) => {
          return {
            // Asked as the request is let go, by which point whatever let it
            // go has been recorded: a stop, or its chunk timeout.
            abortReason: () => {
              const { requestTimedOut, stopReason } =
                self.getSnapshot().context;
              return stopReason ?? (requestTimedOut ? "timeout" : "unknown");
            },
            agent: context.agent,
            model: context.model,
            self,
            sessionId: context.sessionId,
            stepCount: context.stepCount,
            chatId: context.chatId,
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

              const toolCallQueue = parts.filter(
                (part): part is SessionMessagePart.ToolPartInputAvailable =>
                  isToolPart(part) && part.state === "input-available",
              );

              return {
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
              actions: [
                assign({ requestTimedOut: true }),
                raise({ type: "retry" }),
              ],
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
          chatId: context.chatId,
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
          guard: ({ context }) => context.stopReason !== undefined,
          target: "Finishing",
        },
        {
          guard: ({ context }) => context.toolCallQueue.length > 0,
          target: "ExecutingToolCalls",
        },
        {
          target: "MaybeSteering",
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
          chatId: context.chatId,
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
          chatId: context.chatId,
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
          savedIds: context.savedSteerIds,
          chatId: context.chatId,
        }),
        onDone: {
          actions: [
            ({ context, event }) => {
              context.parentRef.send({
                type: "agent.consumedSteer",
                value: { messageIds: event.output },
              });
            },
            assign({ savedSteerIds: [], steeringMessages: [] }),
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
  },
});

export type AgentMachineActorRef = ActorRefFrom<typeof agentMachine>;

/**
 * How many read-only calls run at once. A step asking for more runs them in
 * batches of this size, so twenty searches are not twenty provider requests
 * opened together, each a model call on a plan with its own limits, and twenty
 * image reads are not twenty decodes in memory at once. Eight is the batch
 * that showed the cost of running them one at a time, and a plan served
 * sixteen concurrent searches without refusing any.
 */
const MAX_CONCURRENT_TOOL_CALLS = 8;

/**
 * The calls to run together next: the read-only calls at the head of the queue
 * up to the first one that is not, at most `MAX_CONCURRENT_TOOL_CALLS` of
 * them, or that one alone when it is at the head.
 */
function nextToolCallBatch(
  queue: SessionMessagePart.ToolPartInputAvailable[],
): SessionMessagePart.ToolPartInputAvailable[] {
  const [first] = queue;
  invariant(first, "No tool call to execute");
  if (!getToolByType(first.type).readOnly) {
    return [first];
  }
  const firstWrite = queue.findIndex(
    (part) => !getToolByType(part.type).readOnly,
  );
  return (firstWrite === -1 ? queue : queue.slice(0, firstWrite)).slice(
    0,
    MAX_CONCURRENT_TOOL_CALLS,
  );
}

/**
 * Keyed by the part's own id rather than the provider's `toolCallId`: a
 * provider that repeats a call id within a step would otherwise spawn two
 * children under one id, the second replacing the first, and the first to
 * finish would take both off the queue.
 */
function toolCallActorId(
  part: SessionMessagePart.ToolPartInputAvailable,
): ToolCallActorId {
  return `toolCall:${part.metadata.id}`;
}

function withoutFinishedToolCall(
  context: {
    runningToolCallActorIds: ToolCallActorId[];
    toolCallQueue: SessionMessagePart.ToolPartInputAvailable[];
  },
  actorId: string,
) {
  return {
    runningToolCallActorIds: context.runningToolCallActorIds.filter(
      (id) => id !== actorId,
    ),
    toolCallQueue: context.toolCallQueue.filter(
      (part) => toolCallActorId(part) !== actorId,
    ),
  };
}
