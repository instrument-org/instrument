import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { alphabetical, isEqual } from "radashi";
import invariant from "tiny-invariant";
import {
  type ActorRef,
  type ActorRefFrom,
  type AnyMachineSnapshot,
  assign,
  fromPromise,
  log,
  setup,
  stopChild,
} from "xstate";

import { type AgentName, type AnyAgent } from "../agents/types";
import { createAssignEventError } from "../lib/assign-event-error";
import { createSession } from "../lib/create-session";
import { getCurrentDate } from "../lib/get-current-date";
import { logUnhandledEvent } from "../lib/log-unhandled-event";
import {
  type SpawnAgentFunction,
  type SpawnAgentResult,
} from "../lib/spawn-agent";
import { Store } from "../lib/store";
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

export type SessionMachineParentEvent =
  | {
      type: "session.done";
      value: {
        actorId: string;
        error?: unknown;
        // Undefined for the root session; set for subagents. The task's turn is
        // done when the root session finishes, regardless of subagent refs.
        parentSessionId?: StoreId.Session;
        taskId: TaskId;
        usedNonReadOnlyTools: boolean;
      };
    }
  | {
      type: "session.spawnSubAgent";
      value: {
        agentName: AgentName;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        parentSessionId: StoreId.Session;
        sessionId: StoreId.Session;
        sessionNamePrefix?: string;
        taskId: TaskId;
      };
    };

type ParentActorRef = ActorRef<AnyMachineSnapshot, SessionMachineParentEvent>;

type SessionMachineEvent =
  | AgentParentEvent
  | { type: "addMessage"; value: SessionMessage.UserWithParts }
  | { type: "done" }
  | { type: "error"; value: { message: string } }
  | { type: "stop" }
  | {
      type: "updateInteractiveToolCall";
      value: ToolCallUpdate;
    };

export const sessionMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),

    clearAgentRef: assign({ agentRef: undefined }),

    forceStopAgent: stopChild(({ context }) => context.agentRef ?? "agent"),

    markUsedNonReadOnlyTools: assign({ usedNonReadOnlyTools: true }),

    stopAgent: ({ context }) => {
      if (context.agentRef) {
        context.agentRef.send({ type: "stop" });
      }
    },
  },

  actors: {
    agentMachine,

    saveQueuedMessage: fromPromise<
      SessionMessage.WithParts,
      {
        message: SessionMessage.UserWithParts;
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
      // oxlint-disable-next-line typescript/no-invalid-void-type
      void,
      {
        parentSessionId?: StoreId.Session;
        sessionId: StoreId.Session;
        sessionNamePrefix?: string;
        taskId: TaskId;
      }
    >(
      async ({
        input: { parentSessionId, sessionId, sessionNamePrefix, taskId },
        signal,
      }) => {
        const existingSession = await Store.getSession(sessionId, taskId, {
          signal,
        });
        if (existingSession.isErr()) {
          if (existingSession.error.type === "workspace-not-found-error") {
            const result = await createSession({
              parentSessionId,
              sessionId,
              sessionNamePrefix,
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
            throw new Error(
              `Failed to update session: ${result.error.message}`,
            );
          }
        }
      },
    ),
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
      llmRequestChunkTimeoutMs: number;
      maxStepCount: number;
      model: AIGatewayModel.Type;
      parentRef: ParentActorRef;
      parentSessionId?: StoreId.Session;
      queuedMessages: SessionMessage.UserWithParts[];
      sessionId: StoreId.Session;
      sessionNamePrefix?: string;
      spawnAgent: SpawnAgentFunction;
      subscription?: { unsubscribe: () => void };
      taskId: TaskId;
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
      parentSessionId?: StoreId.Session;
      queuedMessages: SessionMessage.UserWithParts[];
      sessionId: StoreId.Session;
      sessionNamePrefix?: string;
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
        publisher.publish("session.tagsChanged", {
          id: input.taskId,
          sessionId: input.sessionId,
        });
        previousTags = currentTags;
      }
    });

    publisher.publish("session.added", {
      id: input.taskId,
      sessionId: input.sessionId,
    });

    const spawnAgent: SpawnAgentFunction = ({
      agentName,
      prompt,
      sessionNamePrefix,
      signal,
    }) => {
      const newSessionId = StoreId.newSessionId();
      const createdAt = getCurrentDate();
      const messageId = StoreId.newMessageId();

      input.parentRef.send({
        type: "session.spawnSubAgent",
        value: {
          agentName,
          message: {
            id: messageId,
            metadata: { createdAt, sessionId: newSessionId },
            parts: [
              {
                metadata: {
                  createdAt,
                  id: StoreId.newPartId(),
                  messageId,
                  sessionId: newSessionId,
                },
                text: prompt,
                type: "text",
              },
            ],
            role: "user",
          },
          model: input.model,
          parentSessionId: input.sessionId,
          sessionId: newSessionId,
          sessionNamePrefix,
          taskId: input.taskId,
        },
      });

      const completion: SpawnAgentResult["completion"] = new Promise(
        (resolve, reject) => {
          void (async () => {
            try {
              for await (const payload of publisher.subscribe("session.done", {
                signal,
              })) {
                if (payload.sessionId === newSessionId) {
                  const messagesResult = await Store.getMessagesWithParts(
                    {
                      sessionId: newSessionId,
                      taskId: input.taskId,
                    },
                    { signal },
                  );
                  resolve(messagesResult);
                  return;
                }
              }
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          })();
        },
      );

      return { completion, sessionId: newSessionId };
    };

    return {
      agent: input.agent,
      baseLLMRetryDelayMs: input.baseLLMRetryDelayMs,
      llmRequestChunkTimeoutMs: input.llmRequestChunkTimeoutMs,
      maxStepCount: input.maxStepCount ?? 200,
      model: input.model,
      parentRef: input.parentRef,
      parentSessionId: input.parentSessionId,
      queuedMessages: input.queuedMessages,
      sessionId: input.sessionId,
      sessionNamePrefix: input.sessionNamePrefix,
      spawnAgent,
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
    addMessage: {
      actions: assign({
        queuedMessages: ({ context, event }) => [
          ...context.queuedMessages,
          event.value,
        ],
      }),
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
        stop: [
          {
            actions: "stopAgent",
            guard: "isAgentRefActive",
            target: ".Stopping",
          },
          {
            target: ".AgentDone",
          },
        ],
      },

      onDone: "Done",

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
          parentSessionId: context.parentSessionId,
          sessionId: context.sessionId,
        });

        context.parentRef.send({
          type: "session.done",
          value: {
            actorId: self.id,
            error: context.error,
            parentSessionId: context.parentSessionId,
            taskId: context.taskId,
            usedNonReadOnlyTools: context.usedNonReadOnlyTools,
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
            sessionId: context.sessionId,
            taskId: context.taskId,
          };
        },
        onDone: {
          actions: [
            assign({
              agentRef: ({ context, event, self, spawn }) =>
                spawn("agentMachine", {
                  id: "agent",
                  input: {
                    agent: context.agent,
                    baseLLMRetryDelayMs: context.baseLLMRetryDelayMs,
                    llmRequestChunkTimeoutMs: context.llmRequestChunkTimeoutMs,
                    maxStepCount: context.maxStepCount,
                    model: context.model,
                    parentMessageId: event.output.id,
                    parentRef: self,
                    sessionId: context.sessionId,
                    spawnAgent: context.spawnAgent,
                    taskId: context.taskId,
                  },
                }),
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

    UpdatingSession: {
      invoke: {
        input: ({ context }) => ({
          parentSessionId: context.parentSessionId,
          sessionId: context.sessionId,
          sessionNamePrefix: context.sessionNamePrefix,
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
