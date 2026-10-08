import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { alphabetical, isEqual } from "radashi";
import invariant from "tiny-invariant";
import {
  type ActorRef,
  type ActorRefFrom,
  type AnyMachineSnapshot,
  assign,
  enqueueActions,
  fromPromise,
  log,
  setup,
  stopChild,
} from "xstate";

import { type AnyAgent } from "../agents/types";
import { createAssignEventError } from "../lib/assign-event-error";
import { createSession } from "../lib/create-session";
import { logUnhandledEvent } from "../lib/log-unhandled-event";
import {
  type ForkedTurn,
  forkInterruptedTurn,
  interruptedNote,
  keepsTheWork,
} from "../lib/fork-on-interrupt";
import { resolveChat } from "../lib/record-folders";
import { recordChanged } from "../lib/record-changes";
import { Store } from "../lib/store";
import { isTypedByUser } from "../lib/typed-by-user";
import { interruptWaits } from "../lib/wait-interrupts";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { publisher } from "../rpc/publisher";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type SessionTag } from "../schemas/task-agent-status";
import { type TaskId } from "../schemas/task-id";
import {
  agentMachine,
  type AgentMachineActorRef,
  type AgentParentEvent,
  type ToolCallUpdate,
} from "./agent";
import { type StopReason } from "./execute-tool-call";

export type SessionMachineParentEvent = {
  type: "session.done";
  value: {
    actorId: string;
    error?: unknown;
    taskId: TaskId;
    usedNonReadOnlyTools: boolean;
  };
};

type ParentActorRef = ActorRef<AnyMachineSnapshot, SessionMachineParentEvent>;

type SessionMachineEvent =
  | AgentParentEvent
  | {
      /** Stop the step in flight so the message runs as the next turn. */
      interrupt?: boolean;
      /**
       * The model the sender picked, which the next turn this session starts
       * runs on. A step already in flight finishes on the model it began with.
       */
      model: AIGatewayModel.Type;
      saved?: boolean;
      type: "addMessage";
      value: SessionMessage.UserWithParts;
    }
  | { reason?: StopReason; type: "stop" }
  | { type: "done" }
  | { type: "error"; value: { message: string } }
  | { type: "runTurn" }
  | {
      type: "updateInteractiveToolCall";
      value: ToolCallUpdate;
    };

export const sessionMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),

    clearAgentRef: assign({ agentRef: undefined }),

    forceStopAgent: stopChild(({ context }) => context.agentRef ?? "agent"),

    forgetInterruptedTurn: assign({
      interruptedTurn: ({ context, event }) =>
        event.type === "stop" && event.reason === "superseded"
          ? context.interruptedTurn
          : undefined,
    }),

    markUsedNonReadOnlyTools: assign({ usedNonReadOnlyTools: true }),

    spawnAgentMachine: assign({
      agentRef: (
        { context, self, spawn },
        { parentMessageId }: { parentMessageId: StoreId.Message },
      ) =>
        spawn("agentMachine", {
          id: "agent",
          input: {
            agent: context.agent,
            baseLLMRetryDelayMs: context.baseLLMRetryDelayMs,
            llmRequestChunkTimeoutMs: context.llmRequestChunkTimeoutMs,
            maxStepCount: context.maxStepCount,
            model: context.model,
            parentMessageId,
            parentRef: self,
            sessionId: context.sessionId,
            taskId: context.taskId,
          },
        }),
      turnMessageId: (
        _,
        { parentMessageId }: { parentMessageId: StoreId.Message },
      ) => parentMessageId,
    }),

    stopAgent: ({ context, event }) => {
      if (context.agentRef) {
        context.agentRef.send({
          reason: event.type === "stop" ? event.reason : undefined,
          type: "stop",
        });
      }
    },
  },

  actors: {
    agentMachine,

    forkInterruptedTurn: fromPromise<
      ForkedTurn | undefined,
      {
        exclude: StoreId.Message[];
        sessionId: StoreId.Session;
        taskId: TaskId;
        turnMessageId: StoreId.Message;
      }
    >(async ({ input, signal }) => {
      const chatId = resolveChat(input.taskId);
      if (!chatId) {
        return undefined;
      }
      return await forkInterruptedTurn({
        chatId,
        chatSessionId: input.sessionId,
        exclude: input.exclude,
        signal,
        turnMessageId: input.turnMessageId,
      });
    }),

    // Where a turn that brings no message of its own begins: everything the
    // agent writes from here lands after the newest message already stored, so
    // that message is the boundary the turn is measured from. Undefined when
    // the session is empty, which leaves the agent nothing to answer.
    getLastMessageId: fromPromise<
      StoreId.Message | undefined,
      { sessionId: StoreId.Session; taskId: TaskId }
    >(async ({ input, signal }) => {
      const result = await Store.getMessageIds(input.sessionId, input.taskId, {
        signal,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      // ulid sorts oldest to newest
      return alphabetical(result.value, (id) => id).at(-1);
    }),

    saveQueuedMessage: fromPromise<
      SessionMessage.WithParts,
      {
        message: SessionMessage.UserWithParts;
        saved: boolean;
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input, signal }) => {
      const hasMismatchedSessionId = input.message.parts.some(
        (part) => part.metadata.sessionId !== input.sessionId,
      );
      if (hasMismatchedSessionId) {
        throw new Error(
          `Session ID mismatch: expected ${input.sessionId}, found parts with different session IDs`,
        );
      }
      if (input.saved) {
        return input.message;
      }
      const result = await Store.saveMessageWithParts(
        input.message,
        input.taskId,
        { signal },
      );
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    }),

    updateSession: fromPromise<
      void,
      {
        sessionId: StoreId.Session;
        taskId: TaskId;
      }
    >(async ({ input: { sessionId, taskId }, signal }) => {
      const existingSession = await Store.getSession(sessionId, taskId, {
        signal,
      });
      if (existingSession.isErr()) {
        if (existingSession.error.type === "workspace-not-found-error") {
          const result = await createSession({
            sessionId,
            signal,
            taskId,
          });
          if (result.isErr()) {
            throw new Error(
              `Failed to create session: ${result.error.message}`,
            );
          }
          return;
        } else {
          throw new Error(
            `Failed to get session: ${existingSession.error.message}`,
          );
        }
      } else {
        const result = await Store.saveSession(
          {
            ...existingSession.value,
            updatedAt: new Date(),
          },
          taskId,
          { signal },
        );
        if (result.isErr()) {
          throw new Error(`Failed to update session: ${result.error.message}`);
        }
      }
    }),
  },
  guards: {
    // The user wrote to a chat mid-turn, and not to call the work off: the
    // turn's work goes on in a fork once it stops.
    forksOnInterrupt: ({ context, event }) =>
      event.type === "addMessage" &&
      context.turnMessageId !== undefined &&
      resolveChat(context.taskId) !== undefined &&
      isTypedByUser(event.value) &&
      keepsTheWork(event.value),
    isAgentRefActive: ({ context }) =>
      context.agentRef?.getSnapshot().status === "active",
  },
  types: {
    context: {} as {
      agent: AnyAgent;
      agentRef?: AgentMachineActorRef;
      baseLLMRetryDelayMs: number;
      error?: unknown;
      /**
       * The turn a newer message superseded, to fork once it has stopped;
       * see `forksOnInterrupt`. Its user's message.
       */
      interruptedTurn?: StoreId.Message;
      llmRequestChunkTimeoutMs: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentRef: ParentActorRef;
      queuedMessages: SessionMessage.UserWithParts[];
      runRequested: boolean;
      /** Queued messages the sender wrote to the store on arrival; see `addMessage`. */
      savedMessageIds: StoreId.Message[];
      sessionId: StoreId.Session;
      subscription?: { unsubscribe: () => void };
      taskId: TaskId;
      /** The message the running or latest turn answers. */
      turnMessageId?: StoreId.Message;
      usedNonReadOnlyTools: boolean;
    },
    events: {} as SessionMachineEvent,
    input: {} as {
      agent: AnyAgent;
      baseLLMRetryDelayMs: number;
      llmRequestChunkTimeoutMs: number;
      maxStepCount?: number;
      model: AIGatewayModel.Type;
      parentRef: ParentActorRef;
      queuedMessages: SessionMessage.UserWithParts[];
      runRequested?: boolean;
      /** Those of `queuedMessages` the sender wrote to the store on arrival. */
      savedMessageIds?: StoreId.Message[];
      sessionId: StoreId.Session;
      taskId: TaskId;
    },
    tags: {} as SessionTag,
  },
}).createMachine({
  context: ({ input, self }) => {
    let previousTags: string[] = [];

    const subscription = self.subscribe((snapshot) => {
      const currentTags = alphabetical([...snapshot.tags], (tag) => tag);

      if (!isEqual(currentTags, previousTags)) {
        recordChanged(input.taskId, "agent");
        previousTags = currentTags;
      }
    });

    recordChanged(input.taskId, "agent");

    return {
      agent: input.agent,
      baseLLMRetryDelayMs: input.baseLLMRetryDelayMs,
      llmRequestChunkTimeoutMs: input.llmRequestChunkTimeoutMs,
      maxStepCount: input.maxStepCount ?? 200,
      model: input.model,
      parentRef: input.parentRef,
      queuedMessages: input.queuedMessages,
      runRequested: input.runRequested ?? false,
      savedMessageIds: input.savedMessageIds ?? [],
      sessionId: input.sessionId,
      subscription,
      taskId: input.taskId,
      usedNonReadOnlyTools: false,
    };
  },
  id: "session",
  initial: "UpdatingSession",
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
    // A sender that wrote the message to the store first says so: the
    // transcript shows it the moment it was sent, the way a message app does,
    // and whoever runs it later reads it rather than writing it again.
    addMessage: {
      actions: [
        assign({
          model: ({ event }) => event.model,
          queuedMessages: ({ context, event }) => [
            ...context.queuedMessages,
            event.value,
          ],
          savedMessageIds: ({ context, event }) =>
            event.saved
              ? [...context.savedMessageIds, event.value.id]
              : context.savedMessageIds,
        }),
        // A running agent hears it at its next point between steps and then
        // says so, which is what takes it back out of the queue. Until then it
        // stays queued, so a turn that ends first runs it as a turn of its own.
        // A chat's turn is superseded instead: a message the user typed while
        // it was working stops the turn, the turn's work is forked once it
        // stops (fork on interrupt), and the queue runs the message as a turn
        // of its own, over everything said so far. A note from a task or an
        // app steers, since the reply in flight is still the reply to what
        // the user said. A sender that asks to interrupt supersedes any
        // agent's step the same way.
        enqueueActions(({ check, context, enqueue, event }) => {
          const agentRef = context.agentRef;
          if (agentRef?.getSnapshot().status !== "active") {
            return;
          }
          if (
            event.interrupt ||
            (resolveChat(context.taskId) !== undefined &&
              isTypedByUser(event.value))
          ) {
            if (check("forksOnInterrupt")) {
              enqueue.assign({ interruptedTurn: context.turnMessageId });
            }
            enqueue.raise({ reason: "superseded", type: "stop" });
            return;
          }
          agentRef.send({
            saved: event.saved,
            type: "steer",
            value: event.value,
          });
          // The next step may be minutes away inside a wait; end it.
          interruptWaits(context.sessionId);
        }),
      ],
    },
    "agent.consumedSteer": {
      actions: assign({
        queuedMessages: ({ context, event }) =>
          context.queuedMessages.filter(
            (message) => !event.value.messageIds.includes(message.id),
          ),
      }),
    },
    runTurn: {
      actions: assign({ runRequested: true }),
    },
    stop: {
      actions: log("Agent not running"),
    },
    updateInteractiveToolCall: [
      {
        actions: ({ context, event }) => {
          invariant(
            context.agentRef,
            "Agent ref does not exist when finishing tool call",
          );
          context.agentRef.send({
            type: "updateInteractiveToolCall",
            value: event.value,
          });
        },
        guard: ({ context }) => !!context.agentRef,
      },
      {
        actions: log("Agent ref does not exist when finishing tool call"),
      },
    ],
  },
  states: {
    Agent: {
      initial: "UsingReadOnlyTools",

      on: {
        "agent.done": {
          actions: ({ event }) => {
            if (event.value.error) {
              getWorkspaceConfig().captureException(event.value.error, {
                scopes: ["workspace"],
              });
            }
          },
          target: ".AgentDone",
        },
        // Any stop but a newer message's own ends the turn's work outright,
        // so nothing of it is forked.
        stop: [
          {
            actions: ["stopAgent", "forgetInterruptedTurn"],
            guard: "isAgentRefActive",
            target: ".Stopping",
          },
          {
            actions: "forgetInterruptedTurn",
            target: ".AgentDone",
          },
        ],
      },

      // A message that arrived while the agent ran is waiting in the queue, and
      // a turn that ends by finalizing the session would drop it. The queue
      // decides whether this is the end: empty, it is.
      onDone: [
        {
          guard: ({ context }) => context.interruptedTurn !== undefined,
          target: "ForkingInterruptedTurn",
        },
        { target: "ProcessingQueuedMessages" },
      ],

      states: {
        AgentDone: { type: "final" },

        Stopping: {
          after: {
            // Failsafe if the agent does not stop itself promptly.
            1000: {
              actions: ["forceStopAgent", "clearAgentRef"],
              target: "AgentDone",
            },
          },
          always: [{ guard: "isAgentRefActive" }, { target: "AgentDone" }],
          on: {
            "agent.done": {
              actions: "clearAgentRef",
              target: "AgentDone",
            },
            // A stop that lands while the agent waits on an interactive tool
            // makes it leave that wait on the way out, which reports a resume.
            // The session is already stopping, so neither changes anything.
            "agent.paused": {},
            "agent.resumed": {},
          },
        },

        UsingNonReadOnlyTools: {
          initial: "Running",
          on: {
            "agent.paused": ".Paused",
            "agent.resumed": ".Running",
            "agent.usingTool": {
              // No-op because we've already moved to this state
            },
          },
          states: {
            Paused: {
              tags: ["agent.paused"],
            },
            Running: {
              tags: ["agent.running"],
            },
          },
          tags: ["agent.using-non-read-only-tools"],
        },
        UsingReadOnlyTools: {
          initial: "Running",
          on: {
            "agent.paused": ".Paused",
            "agent.resumed": ".Running",
            "agent.usingTool": {
              // No-op because we've already moved to this state
            },
          },
          states: {
            Paused: {
              on: {
                "agent.usingTool": {
                  actions: "markUsedNonReadOnlyTools",
                  guard: ({ event }) => !event.value.readOnly,
                  target: "#session.Agent.UsingNonReadOnlyTools.Paused",
                },
              },
              tags: ["agent.paused"],
            },
            Running: {
              on: {
                "agent.usingTool": {
                  actions: "markUsedNonReadOnlyTools",
                  guard: ({ event }) => !event.value.readOnly,
                  target: "#session.Agent.UsingNonReadOnlyTools.Running",
                },
              },
              tags: ["agent.running"],
            },
          },
        },
      },
      tags: ["agent.alive"],
    },

    Done: {
      entry: ({ context, self }) => {
        if (context.subscription) {
          context.subscription.unsubscribe();
        }

        publisher.publish("session.done", {
          id: context.taskId,
          sessionId: context.sessionId,
        });
        recordChanged(context.taskId, "agent");

        context.parentRef.send({
          type: "session.done",
          value: {
            actorId: self.id,
            error: context.error,
            taskId: context.taskId,
            usedNonReadOnlyTools: context.usedNonReadOnlyTools,
          },
        });
      },
      tags: ["agent.done"],
      type: "final",
    },

    // The turn a newer message superseded goes on in a fork, and the message
    // that superseded it says so to the agent that answers it. Nothing to
    // carry on, or a fork of the chat's already running, and the message
    // simply runs next. A stop here drops the
    // fork, and one that was made as the stop landed stops with it.
    ForkingInterruptedTurn: {
      exit: assign({ interruptedTurn: undefined }),
      invoke: {
        input: ({ context }) => {
          invariant(context.interruptedTurn, "No interrupted turn to fork");
          return {
            exclude: context.queuedMessages.map((message) => message.id),
            sessionId: context.sessionId,
            taskId: context.taskId,
            turnMessageId: context.interruptedTurn,
          };
        },
        onDone: {
          actions: assign(({ context, event }) => {
            const forked = event.output;
            const [first, ...rest] = context.queuedMessages;
            if (!forked || !first) {
              return {};
            }
            return {
              queuedMessages: [
                withNote(first, interruptedNote(forked)),
                ...rest,
              ],
              // Written again with the note, if the sender wrote it already.
              savedMessageIds: context.savedMessageIds.filter(
                (id) => id !== first.id,
              ),
            };
          }),
          target: "ProcessingQueuedMessages",
        },
        onError: {
          actions: ({ event }) => {
            getWorkspaceConfig().captureException(event.error, {
              scopes: ["workspace"],
            });
          },
          target: "ProcessingQueuedMessages",
        },
        src: "forkInterruptedTurn",
      },
      on: {
        stop: "ProcessingQueuedMessages",
      },
      tags: ["agent.alive"],
    },

    ProcessingQueuedMessages: {
      always: [
        {
          guard: ({ context }) => {
            return context.queuedMessages.length > 0;
          },
          target: "SavingMessageAndSpawningAgent",
        },
        {
          guard: ({ context }) => context.runRequested,
          target: "SpawningAgentOverStoredMessages",
        },
        { target: "Done" },
      ],
      tags: ["agent.alive"],
    },

    SavingMessageAndSpawningAgent: {
      invoke: {
        input: ({ context }) => {
          const [message] = context.queuedMessages;
          invariant(message, "No message to save");
          return {
            message,
            saved: context.savedMessageIds.includes(message.id),
            sessionId: context.sessionId,
            taskId: context.taskId,
          };
        },
        onDone: {
          actions: [
            {
              params: ({ event }) => ({ parentMessageId: event.output.id }),
              type: "spawnAgentMachine",
            },
            assign({
              queuedMessages: ({ context }) => {
                const [_, ...rest] = context.queuedMessages;
                return rest;
              },
            }),
          ],
          target: "Agent",
        },
        onError: {
          actions: "assignEventError",
          target: "Done",
        },
        src: "saveQueuedMessage",
      },
      tags: ["agent.alive"],
    },

    // A turn the user asked for without saying anything: the failed one again,
    // and nothing else. The agent reads the same session it always does, so
    // what it answers is the request that was already there.
    SpawningAgentOverStoredMessages: {
      invoke: {
        input: ({ context }) => ({
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: [
          {
            actions: [
              {
                params: ({ event }) => {
                  invariant(event.output, "No message to run from");
                  return { parentMessageId: event.output };
                },
                type: "spawnAgentMachine",
              },
              assign({ runRequested: false }),
            ],
            guard: ({ event }) => event.output !== undefined,
            target: "Agent",
          },
          { target: "Done" },
        ],
        onError: {
          actions: "assignEventError",
          target: "Done",
        },
        src: "getLastMessageId",
      },
      tags: ["agent.alive"],
    },

    UpdatingSession: {
      invoke: {
        input: ({ context }) => ({
          sessionId: context.sessionId,
          taskId: context.taskId,
        }),
        onDone: {
          target: "ProcessingQueuedMessages",
        },
        onError: {
          actions: "assignEventError",
          target: "Done",
        },
        src: "updateSession",
      },
      tags: ["agent.alive"],
    },
  },
});

export type SessionActorRef = ActorRefFrom<typeof sessionMachine>;

/**
 * A message with a note for the agent beside the user's words, as an intent
 * part, which the transcript shows only to developers. Added to one the
 * message already has rather than beside it, since a turn reads one.
 */
function withNote(
  message: SessionMessage.UserWithParts,
  note: string,
): SessionMessage.UserWithParts {
  const existing = message.parts.find((part) => part.type === "data-intent");
  if (existing?.type === "data-intent") {
    return {
      ...message,
      parts: message.parts.map((part) =>
        part === existing
          ? { ...existing, data: { text: `${existing.data.text}\n\n${note}` } }
          : part,
      ),
    };
  }
  return {
    ...message,
    parts: [
      ...message.parts,
      {
        data: { text: note },
        metadata: {
          createdAt: message.metadata.createdAt,
          id: StoreId.newPartId(),
          messageId: message.id,
          sessionId: message.metadata.sessionId,
        },
        type: "data-intent",
      },
    ],
  };
}
