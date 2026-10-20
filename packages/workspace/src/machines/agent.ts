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
import {
  MAX_OUTPUT_LIMIT_REPLIES,
  outputLimitRun,
} from "../lib/output-limit-run";
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

/**
 * Whether the turn goes on, and how many replies it has already spent
 * continuing one the output limit cut off, which is what the message that ends
 * such a turn records.
 */
export type ShouldContinueResult = {
  continue: boolean;
  outputLimitContinuations: number;
};

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
  /**
   * A message that arrived while this turn runs. Held until the next point
   * between steps, then written into the transcript so the next request sees
   * it, the way a person interrupting a colleague is heard at the end of the
   * sentence rather than the end of the job. `saved` when the sender already
   * wrote it to the store.
   */
  | { reason?: StopReason; type: "stop" }
  | { saved?: boolean; type: "steer"; value: SessionMessage.UserWithParts }
  | { type: "llmRequest.chunkReceived" };

type AgentResult = Result<void, "agent-error:unknown">;

type ParentActorRef = ActorRef<AnyMachineSnapshot, AgentParentEvent>;

/**
 * How long an aborted request has to return before the turn goes on without
 * it. The model stream itself ends the moment its abort fires, and what the
 * request does after that (writing the reply as it was cut off, reading its
 * parts back) is disk work that takes milliseconds, so a request reaches this
 * only when something it awaits ignores the abort: a model lookup on the
 * network, a write stuck behind a slow disk. Seconds rather than a fraction
 * of one, so a slow disk still gets its writes in before the turn's end reads
 * them, and few enough that a stop never looks stuck.
 */
export const REQUEST_ABORT_BACKSTOP_MS = 3000;

export const agentMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),
  },

  actors: {
    executeToolCallMachine,

    /**
     * A tool part of this run still in `input-*` when the run ends has no
     * writer left: the stream that saved it is gone, and queued calls are
     * never re-executed on resume, so the part would sit unresolved in the
     * transcript forever, and the resumed model would read only the general
     * answer model-message conversion gives such a call rather than who
     * stopped it. That covers queued siblings of a stopped call, calls an aborted,
     * failed or retried attempt saved (they reach no queue), pending
     * interactive calls, and the calls of a request the machine stopped
     * waiting for. `Finishing` runs this on the paths that can strand one,
     * after `onFinish`. A stop gives the turn `STOP_FAILSAFE_MS` before the
     * session force-stops this actor, and the two have different stakes in
     * that budget: skill changes are consumed as `onFinish` reads them, so a
     * run that misses it loses them, while a sweep that misses leaves parts
     * exactly as they were without it.
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

    landRecords: fromPromise<void, { chatId: ChatId }>(({ input }) =>
      ChatWrites.landed(input.chatId),
    ),

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

    saveOutputLimitMessage: fromPromise<
      void,
      {
        continuations: number;
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
            finishReason: "length",
            modelId: SYNTHETIC_MODEL_ID,
            providerId: "system",
            sessionId: input.sessionId,
            synthetic: true,
          },
          // The same shape as the max-steps stop, and for the same reason: the
          // reply above is the model's own words and this is not, so it is a
          // hidden data part the transcript draws as a card, and the model
          // reads it as a system note on the next user turn (see
          // `outputLimitModelNote`).
          parts: [
            {
              data: { continuations: input.continuations },
              metadata: {
                createdAt: now,
                id: StoreId.newPartId(),
                messageId,
                sessionId: input.sessionId,
              },
              type: "data-outputLimit",
            },
          ],
          role: "assistant",
        },
        input.chatId,
      );

      if (result.isErr()) {
        throw new Error(
          `Failed to save output limit message: ${JSON.stringify(result.error)}`,
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

    /**
     * Whether the turn goes on, and if it stops, whether it stopped because
     * the model kept running out of room to write.
     *
     * A reply cut off at the output limit is text with no tool call, which the
     * agent's own answer reads as a turn that finished, so the run of `length`
     * finishes is counted here and overrides it: the turn carries on until the
     * reply is whole or the bound is reached.
     */
    shouldContinue: fromPromise<
      ShouldContinueResult,
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

      const run = outputLimitRun(messageResults.value);
      if (run >= MAX_OUTPUT_LIMIT_REPLIES) {
        return { continue: false, outputLimitContinuations: run - 1 };
      }
      if (run > 0) {
        return { continue: true, outputLimitContinuations: run - 1 };
      }

      return {
        continue: await input.agent.shouldContinue({
          messages: messageResults.value,
        }),
        outputLimitContinuations: 0,
      };
    }),
  },

  delays: {
    llmRequestChunkTimeoutMs: ({ context }) => context.llmRequestChunkTimeoutMs,
    requestAbortBackstop: REQUEST_ABORT_BACKSTOP_MS,
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
      /** Replies the turn spent continuing one the output limit cut off, when that is why it stopped. */
      outputLimitContinuations: number;
      parentMessageId: StoreId.Message;
      parentRef: ParentActorRef;
      /**
       * An attempt ended without handing its calls to the queue, so some of
       * this run's tool parts may still read `input-*` and the finish sweeps.
       */
      partsLeftBehind: boolean;
      /** Aborts the request in flight, with why, while the machine waits for it; one per request. */
      requestStop?: AbortController;
      /** The attempt in flight timed out or failed in a way another attempt can fix; cleared as each starts. */
      retryable: boolean;
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
    },
    output: {} as AgentResult,
  },
}).createMachine({
  context: ({ input }) => ({
    agent: input.agent,
    baseLLMRetryDelayMs: input.baseLLMRetryDelayMs,
    llmRequestChunkTimeoutMs: input.llmRequestChunkTimeoutMs,
    maxAttemptCount: 3,
    maxStepCount: input.maxStepCount,
    model: input.model,
    outputLimitContinuations: 0,
    parentMessageId: input.parentMessageId,
    parentRef: input.parentRef,
    partsLeftBehind: false,
    retryable: false,
    retryCount: 0,
    runningToolCallActorIds: [],
    savedSteerIds: [],
    sessionId: input.sessionId,
    steeringMessages: [],
    stepCount: 0,
    chatId: input.chatId,
    toolCallQueue: [],
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
      on: { stop: {} },
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
      // Already finishing: a stop says why, for the sweep, and runs nothing
      // again, since `onFinish` consumes what it reads.
      on: {
        stop: {
          actions: assign({
            stopReason: ({ event }) => event.reason ?? "manual",
          }),
        },
      },
      states: {
        FinalizingDanglingToolCalls: {
          invoke: {
            input: ({ context }) => ({
              parentMessageId: context.parentMessageId,
              sessionId: context.sessionId,
              stopReason: context.stopReason,
              chatId: context.chatId,
            }),
            onDone: "LandingRecords",
            onError: { actions: "assignEventError", target: "LandingRecords" },
            src: "finalizeDanglingToolCalls",
          },
        },
        /**
         * The turn is over once what it wrote is in the chat's files, so
         * everything that hears `agent.done` (the session's end, and the
         * wake, retitle, unread mark and CHAT.md it starts) reads all of it.
         */
        LandingRecords: {
          invoke: {
            input: ({ context }) => ({ chatId: context.chatId }),
            onDone: "#agent.Done",
            onError: "#agent.Done",
            src: "landRecords",
          },
        },
        MaybeFinalizingDanglingToolCalls: {
          always: [
            {
              // Every attempt of this run handed its tool parts to the queues,
              // both queues are drained, and no stop cut a call short, so
              // nothing of this run is left in `input-*` and the sweep would
              // buy the turn nothing for the read it costs.
              guard: ({ context }) =>
                !context.partsLeftBehind &&
                context.stopReason === undefined &&
                context.toolCallQueue.length === 0,
              target: "LandingRecords",
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

    /**
     * One request to the model, and every way out of it waits for the request
     * to return: a stop or the chunk timeout aborts it through `requestStop`,
     * with why, and the machine leaves once it has returned, so what it was
     * holding is written before anything after it reads the records.
     */
    LLMStreaming: {
      entry: assign({
        requestStop: () => new AbortController(),
        retryable: false,
      }),
      initial: "Streaming",
      invoke: {
        input: ({ context, self }) => ({
          agent: context.agent,
          model: context.model,
          self,
          sessionId: context.sessionId,
          stepCount: context.stepCount,
          stop: context.requestStop?.signal,
          chatId: context.chatId,
        }),
        onDone: [
          {
            // A reply the model finished: its calls run next.
            actions: assign(({ event: { output } }) => ({
              retryCount: 0,
              toolCallQueue: output.parts.filter(
                (part): part is SessionMessagePart.ToolPartInputAvailable =>
                  isToolPart(part) && part.state === "input-available",
              ),
            })),
            guard: ({ context, event: { output } }) =>
              context.requestStop?.signal.aborted !== true &&
              getErrorAction(output.message).type === "continue",
            target: "MaybeExecutingToolCalls",
          },
          {
            // An abort of ours already says why. Otherwise the reply's error
            // does: one another attempt can fix, or one where the request
            // ended itself in a way no retry helps (its own abort, a full
            // disk, a refused credential).
            actions: assign(({ context, event: { output } }) => {
              if (context.requestStop?.signal.aborted) {
                return {};
              }
              const action = getErrorAction(output.message).type;
              if (action === "retry") {
                return { retryable: true };
              }
              return action === "stop" ? { stopReason: "manual" as const } : {};
            }),
            target: "MaybeRetrying",
          },
        ],
        onError: { actions: "assignEventError", target: "MaybeRetrying" },
        src: "llmRequestLogic",
      },
      on: {
        stop: {
          actions: [
            assign({ stopReason: ({ event }) => event.reason ?? "manual" }),
            ({ context, event }) => {
              context.requestStop?.abort(event.reason ?? "manual");
            },
          ],
          target: ".Aborting",
        },
      },
      states: {
        /**
         * Aborted, and waiting for the request to return. A request that
         * never does is left behind after `REQUEST_ABORT_BACKSTOP_MS`, still
         * writing on its own, and the finish sweeps whatever it left.
         */
        Aborting: {
          after: { requestAbortBackstop: "#agent.MaybeRetrying" },
          on: {
            "llmRequest.chunkReceived": {},
            stop: {
              actions: assign({
                stopReason: ({ event }) => event.reason ?? "manual",
              }),
            },
          },
        },
        Streaming: {
          after: {
            llmRequestChunkTimeoutMs: {
              actions: [
                assign({ retryable: true }),
                ({ context }) => {
                  context.requestStop?.abort("timeout");
                },
              ],
              target: "Aborting",
            },
          },
          on: {
            // Starts the chunk timeout over.
            "llmRequest.chunkReceived": { reenter: true, target: "Streaming" },
          },
        },
      },
    },

    /**
     * Where an attempt that handed nothing to the queue goes: tried again when
     * another attempt can help and one is left, and otherwise the turn ends.
     */
    MaybeRetrying: {
      always: [
        {
          actions: assign({
            retryCount: ({ context }) => context.retryCount + 1,
          }),
          guard: ({ context }) =>
            context.stopReason === undefined &&
            context.retryable &&
            // The first request spent one of the attempts.
            context.retryCount + 1 < context.maxAttemptCount,
          target: "RetryingWithDelay",
        },
        { target: "Finishing" },
      ],
      entry: assign({ partsLeftBehind: true }),
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
              return output.continue;
            },
            target: "MaybeStartingLLMRequest",
          },
          {
            actions: assign({
              outputLimitContinuations: ({ event: { output } }) =>
                output.outputLimitContinuations,
            }),
            guard: ({ event: { output } }) => {
              return output.outputLimitContinuations > 0;
            },
            target: "SavingOutputLimitMessage",
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

    SavingOutputLimitMessage: {
      invoke: {
        input: ({ context }) => ({
          continuations: context.outputLimitContinuations,
          sessionId: context.sessionId,
          chatId: context.chatId,
        }),
        onDone: "Finishing",
        onError: { actions: "assignEventError", target: "Finishing" },
        src: "saveOutputLimitMessage",
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
