import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { alphabetical, isEqual, unique } from "radashi";
import invariant from "tiny-invariant";
import {
  type ActorRef,
  type ActorRefFrom,
  type AnyMachineSnapshot,
  assign,
  enqueueActions,
  fromPromise,
  setup,
  stopChild,
} from "xstate";

import { type AnyAgent } from "../agents/types";
import { createAssignEventError } from "../lib/assign-event-error";
import { ChatReads } from "../lib/chat-reads";
import { ChatWrites } from "../lib/chat-writes";
import { MID_TURN_NOTE } from "../lib/chat/mid-turn";
import { logUnhandledEvent } from "../lib/log-unhandled-event";
import { sessionRole } from "../lib/chat/children";
import { recordChanged } from "../lib/record-changes";
import { isTypedByUser } from "../lib/typed-by-user";
import { interruptWaits } from "../lib/wait-interrupts";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { publisher } from "../rpc/publisher";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type SessionTag } from "../schemas/chat-agent-status";
import { type ChatId } from "../schemas/chat-id";
import {
  agentMachine,
  type AgentMachineActorRef,
  type AgentParentEvent,
} from "./agent";
import { type StopNotice } from "../schemas/stop-notice";
import { type StopReason } from "./execute-tool-call";

/**
 * How many steps a session takes in one run before it stops and offers to
 * carry on. A backstop against a run that never ends rather than a budget
 * for work: a run that goes this far has nothing left to finish on its own,
 * and the person's yes is cheaper than another thousand steps.
 */
const UNATTENDED_STEPS = 500;

export type SessionMachineParentEvent = {
  type: "session.done";
  value: {
    actorId: string;
    error?: unknown;
    chatId: ChatId;
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
  | { notice?: StopNotice; reason?: StopReason; type: "stop" }
  | { type: "done" }
  | { type: "error"; value: { message: string } }
  | { type: "runTurn" };

export const sessionMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),

    clearAgentRef: assign({ agentRef: undefined }),

    // The person's Stop outranks one that lands after it, such as the chat's
    // own `instrument task stop` on the same task a moment later: theirs is the one the
    // chat is told of.
    rememberStopNotice: assign({
      stopNotice: ({ context, event }) =>
        context.stopNotice?.by === "user"
          ? context.stopNotice
          : ((event.type === "stop" ? event.notice : undefined) ??
            context.stopNotice),
    }),

    dropFirstQueued: assign({
      queuedMessages: ({ context }) => context.queuedMessages.slice(1),
    }),

    forceStopAgent: stopChild(({ context }) => context.agentRef ?? "agent"),

    holdQueued: assign(({ context }) => heldQueue(context)),

    holdQueuedOnPersonsStop: assign(({ context, event }) =>
      event.type === "stop" && event.notice?.by === "user"
        ? heldQueue(context)
        : {},
    ),

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
            chatId: context.chatId,
          },
        }),
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

    // Where a turn that brings no message of its own begins: everything the
    // agent writes from here lands after the newest message already stored, so
    // that message is the boundary the turn is measured from. Undefined when
    // the session is empty, which leaves the agent nothing to answer.
    getLastMessageId: fromPromise<
      StoreId.Message | undefined,
      { sessionId: StoreId.Session; chatId: ChatId }
    >(async ({ input }) => {
      const result = await ChatReads.messageIds({
        chatId: input.chatId,
        sessionId: input.sessionId,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value.at(-1);
    }),

    saveQueuedMessage: fromPromise<
      SessionMessage.WithParts,
      {
        message: SessionMessage.UserWithParts;
        saved: boolean;
        sessionId: StoreId.Session;
        chatId: ChatId;
      }
    >(async ({ input }) => {
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
      const result = await ChatWrites.saveMessageWithParts(
        input.message,
        input.chatId,
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
        chatId: ChatId;
      }
    >(async ({ input: { sessionId, chatId } }) => {
      const existingSession = await ChatReads.session({
        chatId,
        sessionId,
      });
      // Every session is written before its first message: a chat's with
      // the chat, a task's when the chat starts it.
      if (existingSession.isErr()) {
        throw new Error(
          `Failed to get session: ${existingSession.error.message}`,
        );
      } else {
        const result = await ChatWrites.saveSession(
          {
            ...existingSession.value,
            updatedAt: new Date(),
          },
          chatId,
        );
        if (result.isErr()) {
          throw new Error(`Failed to update session: ${result.error.message}`);
        }
      }
    }),
  },
  guards: {
    isAgentRefActive: ({ context }) =>
      context.agentRef?.getSnapshot().status === "active",
  },
  types: {
    context: {} as {
      agent: AnyAgent;
      agentRef?: AgentMachineActorRef;
      baseLLMRetryDelayMs: number;
      error?: unknown;
      /** Queued messages a stop held; see `holdQueued`. */
      heldMessageIds: StoreId.Message[];
      llmRequestChunkTimeoutMs: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentRef: ParentActorRef;
      queuedMessages: SessionMessage.UserWithParts[];
      runRequested: boolean;
      /** Queued messages the sender wrote to the store on arrival; see `addMessage`. */
      savedMessageIds: StoreId.Message[];
      sessionId: StoreId.Session;
      /** Whose stop ended a turn of this session; goes out with `session.done`. */
      stopNotice?: StopNotice;
      subscription?: { unsubscribe: () => void };
      chatId: ChatId;
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
      chatId: ChatId;
    },
    tags: {} as SessionTag,
  },
}).createMachine({
  context: ({ input, self }) => {
    let previousTags: string[] = [];

    const subscription = self.subscribe((snapshot) => {
      const currentTags = alphabetical([...snapshot.tags], (tag) => tag);

      if (!isEqual(currentTags, previousTags)) {
        recordChanged(input.chatId, "agent");
        previousTags = currentTags;
      }
    });

    recordChanged(input.chatId, "agent");

    return {
      agent: input.agent,
      baseLLMRetryDelayMs: input.baseLLMRetryDelayMs,
      heldMessageIds: [],
      llmRequestChunkTimeoutMs: input.llmRequestChunkTimeoutMs,
      maxStepCount: input.maxStepCount ?? UNATTENDED_STEPS,
      model: input.model,
      parentRef: input.parentRef,
      queuedMessages: input.queuedMessages,
      runRequested: input.runRequested ?? false,
      savedMessageIds: input.savedMessageIds ?? [],
      sessionId: input.sessionId,
      subscription,
      chatId: input.chatId,
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
        // A message the user typed into a chat's working turn joins it the
        // same way, with a note that it arrived mid-turn, and the turn decides
        // what it is (lib/chat/mid-turn.ts). A sender that asks to interrupt,
        // as the Stop button does, supersedes the turn.
        enqueueActions(({ context, enqueue, event }) => {
          const agentRef = context.agentRef;
          if (agentRef?.getSnapshot().status !== "active") {
            return;
          }
          const typedIntoChat =
            sessionRole(context.chatId, context.sessionId) === "chat" &&
            isTypedByUser(event.value);
          if (event.interrupt) {
            enqueue.raise({ reason: "superseded", type: "stop" });
            return;
          }
          let message = event.value;
          let saved = event.saved;
          if (typedIntoChat) {
            message = withNote(message, MID_TURN_NOTE);
            // Written again with the note, if the sender wrote it already.
            saved = false;
            enqueue.assign({
              queuedMessages: context.queuedMessages.map((queued) =>
                queued.id === message.id ? message : queued,
              ),
              savedMessageIds: context.savedMessageIds.filter(
                (id) => id !== message.id,
              ),
            });
          }
          agentRef.send({ saved, type: "steer", value: message });
          // The next step may be minutes away inside a wait, an `fg` or a
          // foreground command; end it. The command itself keeps running in
          // the background (tools/bash.ts).
          interruptWaits(context.sessionId, {
            from: typedIntoChat ? "user" : "other",
          });
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
    // Before the agent runs, any stop holds what is queued, so no turn
    // starts.
    stop: {
      actions: ["rememberStopNotice", "holdQueued"],
    },
  },
  states: {
    Agent: {
      initial: "Running",

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
        // The person's Stop of a running turn holds what waits behind it too,
        // a message or a wake note, which would otherwise start the agent
        // again as soon as it winds down. Any other stop of a running turn
        // leaves the queue to run: a newer message superseding the reply is
        // the one that has to.
        stop: [
          {
            actions: [
              "rememberStopNotice",
              "holdQueuedOnPersonsStop",
              "stopAgent",
            ],
            guard: "isAgentRefActive",
            target: ".Stopping",
          },
          {
            actions: ["rememberStopNotice", "holdQueuedOnPersonsStop"],
            target: ".AgentDone",
          },
        ],
      },

      // A message that arrived while the agent ran is waiting in the queue, and
      // a turn that ends by finalizing the session would drop it. The queue
      // decides whether this is the end: empty, it is.
      onDone: { target: "ProcessingQueuedMessages" },

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
          },
        },

        Running: {
          tags: ["agent.running"],
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
          id: context.chatId,
          ...(context.stopNotice ? { notice: context.stopNotice } : {}),
          sessionId: context.sessionId,
        });
        recordChanged(context.chatId, "agent");

        context.parentRef.send({
          type: "session.done",
          value: {
            actorId: self.id,
            error: context.error,
            chatId: context.chatId,
          },
        });
      },
      tags: ["agent.done"],
      type: "final",
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
            chatId: context.chatId,
          };
        },
        onDone: [
          {
            // Held by a stop: the message stays, unanswered.
            actions: "dropFirstQueued",
            guard: ({ context, event }) =>
              context.heldMessageIds.includes(event.output.id),
            target: "ProcessingQueuedMessages",
          },
          {
            actions: [
              {
                params: ({ event }) => ({ parentMessageId: event.output.id }),
                type: "spawnAgentMachine",
              },
              "dropFirstQueued",
            ],
            target: "Agent",
          },
        ],
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
          chatId: context.chatId,
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
            guard: ({ context, event }) =>
              event.output !== undefined && context.runRequested,
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
          chatId: context.chatId,
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
 * What is queued as a stop lands is held: saved, and left unanswered rather
 * than run, and a run asked for over the stored session is called off.
 * Whatever arrives after the stop runs as usual.
 */
function heldQueue(context: {
  heldMessageIds: StoreId.Message[];
  queuedMessages: SessionMessage.UserWithParts[];
}) {
  return {
    heldMessageIds: unique([
      ...context.heldMessageIds,
      ...context.queuedMessages.map((message) => message.id),
    ]),
    runRequested: false,
  };
}

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
