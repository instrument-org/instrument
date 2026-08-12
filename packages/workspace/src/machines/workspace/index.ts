import {
  type AIGatewayApp,
  type AIGatewayModel,
  type GetProviderConfigs,
  type ModelCache,
} from "@instrument-org/ai-gateway";
import {
  type CaptureEventFunction,
  type CaptureExceptionFunction,
} from "@instrument-org/shared";
import ms from "ms";
import {
  type ActorRefFrom,
  assign,
  enqueueActions,
  log,
  raise,
  setup,
  type SnapshotFrom,
} from "xstate";

import { AGENTS } from "../../agents/all";
import { type AgentName } from "../../agents/types";
import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import { createAssignEventError } from "../../lib/assign-event-error";
import { logUnhandledEvent } from "../../lib/log-unhandled-event";
import { setTaskIndicator } from "../../lib/task-indicators";
import { setWorkspaceConfig } from "../../lib/workspace-config";
import { workspaceServerLogic } from "../../logic/server";
import { type WorkspaceServerParentEvent } from "../../logic/server/types";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { type WebSearchClient } from "../../schemas/web-search";
import {
  type BrowserConfig,
  type BrowserTargetId,
  type WorkspaceConfig,
} from "../../types";
import { type ToolCallUpdate } from "../agent";
import { runtimeMachine } from "../runtime";
import {
  type SessionActorRef,
  sessionMachine,
  type SessionMachineParentEvent,
} from "../session";
import {
  taskBrowserMachine,
  type TaskBrowserParentEvent,
} from "../task-browser";
import { type WorkspaceContext } from "./types";

export type WorkspaceEvent =
  | SessionMachineParentEvent
  | TaskBrowserParentEvent
  | WorkspaceServerParentEvent
  | {
      type: "acquireBrowserPresence";
      value: { id: TaskId };
    }
  | {
      type: "addMessage";
      value: {
        agentName: AgentName;
        id: TaskId;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "createSession";
      value: {
        agentName: AgentName;
        id: TaskId;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "heartbeat";
      value: {
        createdAt: number;
        shouldCreate: boolean;
        taskId: TaskId;
      };
    }
  | {
      type: "internal.spawnSession";
      value: {
        agentName: AgentName;
        // Absent for a turn that runs over what the session already holds.
        message?: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        parentSessionId?: StoreId.Session;
        runRequested?: boolean;
        sessionId: StoreId.Session;
        sessionNamePrefix?: string;
        taskId: TaskId;
      };
    }
  | {
      type: "internal.updateHeartbeat";
      value: { createdAt: number; id: TaskId };
    }
  | {
      type: "prepareToTrashTask";
      value: { id: TaskId; onBrowserReaped?: () => void };
    }
  | {
      type: "registerBrowserTarget";
      value: {
        id: TaskId;
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        targetId: BrowserTargetId;
      };
    }
  | {
      type: "releaseBrowserPresence";
      value: { id: TaskId };
    }
  | { type: "removeTaskBeingTrashed"; value: { id: TaskId } }
  | {
      type: "restartAllRuntimes";
    }
  | {
      type: "restartRuntime";
      value: { id: TaskId };
    }
  | {
      type: "runTurn";
      value: {
        agentName: AgentName;
        id: TaskId;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "spawnRuntime";
      value: { taskId: TaskId };
    }
  | {
      type: "stopRuntime";
      value: {
        id: TaskId;
        includeChildren?: boolean;
      };
    }
  | {
      type: "stopSessions";
      value: { id: TaskId };
    }
  | {
      type: "updateInteractiveToolCall";
      value: {
        id: TaskId;
        update: ToolCallUpdate;
      };
    };

// The session actor for a task, while it still has a turn to run. A session
// that finished dropped its ref, so anything asking for another turn spawns a
// fresh actor over the same stored session rather than reaching for this one.
function findLiveSessionRef(
  context: WorkspaceContext,
  { id, sessionId }: { id: TaskId; sessionId: StoreId.Session },
) {
  return context.sessionRefsByTaskId
    .get(id)
    ?.find(
      (ref) =>
        ref.getSnapshot().context.sessionId === sessionId &&
        ref.getSnapshot().status === "active",
    );
}

export const workspaceMachine = setup({
  actions: {
    acquireBrowserPresence: enqueueActions(
      ({ enqueue }, { id }: { id: TaskId }) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.taskBrowserRefs.get(id);
          const ref =
            existing ??
            spawn("taskBrowserMachine", {
              input: {
                browser: context.config.browser,
                id,
              },
            });
          ref.send({ type: "acquirePresence" });
          if (existing) {
            return {};
          }
          return {
            taskBrowserRefs: new Map(context.taskBrowserRefs).set(id, ref),
          };
        });
      },
    ),

    assignEventError: createAssignEventError(),

    clearSessionRefsByTaskId: assign(({ context }, { id }: { id: TaskId }) => {
      const newsessionRefsByTaskId = new Map<TaskId, SessionActorRef[]>();

      for (const [
        sessionTaskId,
        refs,
      ] of context.sessionRefsByTaskId.entries()) {
        const shouldRemove = sessionTaskId === id;

        if (shouldRemove) {
          continue;
        }

        newsessionRefsByTaskId.set(sessionTaskId, refs);
      }

      return {
        sessionRefsByTaskId: newsessionRefsByTaskId,
      };
    }),

    forwardAttachAgentSession: enqueueActions(
      (
        { context },
        { id, sessionId }: { id: TaskId; sessionId: StoreId.Session },
      ) => {
        const ref = context.taskBrowserRefs.get(id);
        ref?.send({
          type: "attachAgentSession",
          value: { sessionId },
        });
      },
    ),

    // Get-or-spawn the task's browser machine and forward a target event to it.
    // The user-open (`registerTarget`) and agent CDP (`updateCdpHeartbeat`) paths
    // carry the same payload and differ only in which event the ref receives;
    // the ref decides how each affects its liveness state.
    forwardToTaskBrowser: enqueueActions(
      (
        { enqueue },
        {
          event,
          id,
          partitionDir,
          sessionId,
          targetId,
        }: {
          event: "registerTarget" | "updateCdpHeartbeat";
          id: TaskId;
          partitionDir: AbsolutePath;
          sessionId: StoreId.Session;
          targetId: BrowserTargetId;
        },
      ) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.taskBrowserRefs.get(id);
          const ref =
            existing ??
            spawn("taskBrowserMachine", {
              input: {
                browser: context.config.browser,
                id,
              },
            });
          ref.send({
            type: event,
            value: { partitionDir, sessionId, targetId },
          });
          if (existing) {
            return {};
          }
          return {
            taskBrowserRefs: new Map(context.taskBrowserRefs).set(id, ref),
          };
        });
      },
    ),

    forwardUpdateHeartbeat: enqueueActions(
      ({ context }, { createdAt, id }: { createdAt: number; id: TaskId }) => {
        const runtimeRef = context.runtimeRefs.get(id);
        runtimeRef?.send({
          type: "updateHeartbeat",
          value: { createdAt },
        });
      },
    ),

    handleTaskBrowserStopped: enqueueActions(
      ({ context, enqueue }, { id }: { id: TaskId }) => {
        const ref = context.taskBrowserRefs.get(id);
        if (ref) {
          enqueue.stopChild(ref);
        }
        const nextRefs = new Map(context.taskBrowserRefs);
        nextRefs.delete(id);
        enqueue.assign({ taskBrowserRefs: nextRefs });

        const resolvers = context.pendingBrowserReapResolvers.get(id);
        if (resolvers && resolvers.length > 0) {
          for (const resolve of resolvers) {
            resolve();
          }
          const nextResolvers = new Map(context.pendingBrowserReapResolvers);
          nextResolvers.delete(id);
          enqueue.assign({ pendingBrowserReapResolvers: nextResolvers });
        }
      },
    ),

    // Persist an unread indicator so the sidebar/tab can surface a dot until
    // the user views the task. Writing task settings publishes task.updated,
    // which the live indicators stream re-reads from.
    dropSessionRef: assign(
      ({ context }, { actorId, id }: { actorId: string; id: TaskId }) => {
        const existingSessionActorRefs = context.sessionRefsByTaskId.get(id);
        if (!existingSessionActorRefs) {
          return {};
        }

        const remaining = existingSessionActorRefs.filter(
          (ref) => ref.id !== actorId,
        );

        const newSessionRefsByTaskId = new Map(context.sessionRefsByTaskId);
        if (remaining.length > 0) {
          newSessionRefsByTaskId.set(id, remaining);
        } else {
          newSessionRefsByTaskId.delete(id);
        }

        return {
          sessionRefsByTaskId: newSessionRefsByTaskId,
        };
      },
    ),

    markTaskUnread: (_, { id }: { id: TaskId }) => {
      void setTaskIndicator(id, "completed");
    },

    releaseBrowserPresence: enqueueActions(
      ({ context }, { id }: { id: TaskId }) => {
        context.taskBrowserRefs.get(id)?.send({ type: "releasePresence" });
      },
    ),

    stopRuntime: enqueueActions(
      ({ context, enqueue }, { id }: { id: TaskId }) => {
        const runtimeRef = context.runtimeRefs.get(id);
        const remainingRefs = new Map(context.runtimeRefs);
        remainingRefs.delete(id);
        if (runtimeRef) {
          enqueue.stopChild(runtimeRef);
          enqueue.assign({ runtimeRefs: remainingRefs });
        }
      },
    ),

    trackSessionRef: assign(
      (
        { context },
        {
          id,
          sessionRef,
        }: {
          id: TaskId;
          sessionRef: SessionActorRef;
        },
      ) => {
        const existingSessionActorRefs =
          context.sessionRefsByTaskId.get(id) ?? [];

        const activeSessionActorRefs = existingSessionActorRefs.filter(
          (ref) => ref.getSnapshot().status !== "done",
        );

        const newSessionRefsByTaskId = new Map(context.sessionRefsByTaskId);
        newSessionRefsByTaskId.set(id, [...activeSessionActorRefs, sessionRef]);

        return {
          sessionRefsByTaskId: newSessionRefsByTaskId,
        };
      },
    ),
  },

  actors: {
    runtimeMachine,

    sessionMachine,

    taskBrowserMachine,

    workspaceServerLogic,
  },

  types: {
    context: {} as WorkspaceContext,
    events: {} as WorkspaceEvent,
    input: {} as {
      aiGatewayApp: AIGatewayApp;
      appVersion: string;
      browser: BrowserConfig;
      captureEvent: CaptureEventFunction;
      captureException: CaptureExceptionFunction;
      defaultTaskTemplateDir: string;
      getAIProviderConfigs: GetProviderConfigs;
      isExternalBrowserEnabled: () => boolean;
      modelCache: ModelCache;
      nodeExecEnv: Record<string, string>;
      pnpmBinPath: string;
      registryDir: string;
      rootDir: string;
      shimClientDir: string;
      systemSkillsDir: string;
      trashItem: (path: AbsolutePath) => Promise<void>;
      uvBinPath: string;
      uvDataDir: string;
      webSearch: WebSearchClient;
    },
    output: {},
  },
}).createMachine({
  context: ({ input, self, spawn }) => {
    const rootDir = WorkspaceDirSchema.parse(input.rootDir);
    const workspaceConfig: WorkspaceConfig = {
      appVersion: input.appVersion,
      browser: input.browser,
      captureEvent: input.captureEvent,
      captureException: input.captureException,
      defaultTaskTemplateDir: AbsolutePathSchema.parse(
        input.defaultTaskTemplateDir,
      ),
      getAIProviderConfigs: input.getAIProviderConfigs,
      isExternalBrowserEnabled: input.isExternalBrowserEnabled,
      modelCache: input.modelCache,
      nodeExecEnv: input.nodeExecEnv,
      pnpmBinPath: AbsolutePathSchema.parse(input.pnpmBinPath),
      projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
      registryDir: AbsolutePathSchema.parse(input.registryDir),
      rootDir,
      systemSkillsDir: AbsolutePathSchema.parse(input.systemSkillsDir),
      tasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
      trashItem: input.trashItem,
      uvBinPath: AbsolutePathSchema.parse(input.uvBinPath),
      uvDataDir: AbsolutePathSchema.parse(input.uvDataDir),
      webSearch: input.webSearch,
    };
    // Publish the single per-process config so code can read it via
    // getWorkspaceConfig() instead of threading it through every TaskId.
    setWorkspaceConfig(workspaceConfig);
    return {
      config: workspaceConfig,
      pendingBrowserReapResolvers: new Map(),
      runtimeRefs: new Map(),
      sessionRefsByTaskId: new Map(),
      taskBrowserRefs: new Map(),
      tasksBeingTrashed: [],
      workspaceServerRef: spawn("workspaceServerLogic", {
        input: {
          aiGatewayApp: input.aiGatewayApp,
          parentRef: self,
          shimClientDir:
            input.shimClientDir === "dev-server"
              ? "dev-server"
              : AbsolutePathSchema.parse(input.shimClientDir),
          workspaceConfig,
        },
      }),
    };
  },
  id: "workspace",
  initial: "Running",
  on: {
    "*": {
      actions: ({ context, event, self }) => {
        logUnhandledEvent({
          captureException: context.config.captureException,
          event,
          self,
        });
      },
    },
    acquireBrowserPresence: {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "acquireBrowserPresence",
      },
    },
    addMessage: [
      {
        actions: ({ context, event }) => {
          const targetRef = findLiveSessionRef(context, event.value);
          targetRef?.send({
            type: "addMessage",
            value: event.value.message,
          });
        },
        guard: ({ context, event }) =>
          findLiveSessionRef(context, event.value) !== undefined,
      },
      {
        actions: raise(({ event }) => {
          const id = event.value.id;
          const taskId = id;
          return {
            type: "internal.spawnSession",
            value: {
              agentName: event.value.agentName,
              message: event.value.message,
              model: event.value.model,
              sessionId: event.value.sessionId,
              taskId,
            },
          };
        }),
      },
    ],
    createSession: {
      actions: raise(({ event }) => {
        const taskId = event.value.id;
        return {
          type: "internal.spawnSession",
          value: {
            agentName: event.value.agentName,
            message: event.value.message,
            model: event.value.model,
            sessionId: event.value.sessionId,
            taskId,
          },
        };
      }),
    },
    heartbeat: [
      {
        actions: raise(({ context, event }) => {
          const existingRuntimeRef = context.runtimeRefs.get(
            event.value.taskId,
          );

          if (existingRuntimeRef) {
            return {
              type: "internal.updateHeartbeat",
              value: {
                createdAt: event.value.createdAt,
                id: event.value.taskId,
              },
            };
          }

          return {
            type: "spawnRuntime",
            value: {
              taskId: event.value.taskId,
            },
          };
        }),
      },
    ],
    "internal.spawnSession": {
      actions: enqueueActions(({ enqueue, event, self }) => {
        enqueue.assign(({ spawn }) => {
          const {
            agentName,
            message,
            model,
            parentSessionId,
            runRequested,
            sessionId,
            sessionNamePrefix,
            taskId,
          } = event.value;

          const sessionMachineRef = spawn("sessionMachine", {
            input: {
              agent: AGENTS[agentName],
              baseLLMRetryDelayMs: ms("1 second"),
              llmRequestChunkTimeoutMs: ms("5 minutes"),
              model,
              parentRef: self,
              parentSessionId,
              queuedMessages: message ? [message] : [],
              runRequested,
              sessionId,
              sessionNamePrefix,
              taskId,
            },
          });

          enqueue({
            params: {
              id: taskId,
              sessionRef: sessionMachineRef,
            },
            type: "trackSessionRef",
          });

          return {};
        });
      }),
      guard: ({ context, event }) => {
        const id = event.value.taskId;
        return !context.tasksBeingTrashed.includes(id);
      },
    },
    "internal.updateHeartbeat": {
      actions: {
        params: ({ event }) => ({
          createdAt: event.value.createdAt,
          id: event.value.id,
        }),
        type: "forwardUpdateHeartbeat",
      },
    },
    prepareToTrashTask: {
      actions: enqueueActions(({ context, enqueue, event }) => {
        enqueue.assign({
          tasksBeingTrashed: [...context.tasksBeingTrashed, event.value.id],
        });

        // Reap the trashed task's taskBrowser, if one exists.
        const matchingTaskIds: TaskId[] = [];
        const browserRef = context.taskBrowserRefs.get(event.value.id);
        if (browserRef) {
          matchingTaskIds.push(event.value.id);
          browserRef.send({ type: "forceReap" });
        }

        if (event.value.onBrowserReaped) {
          const resolver = event.value.onBrowserReaped;
          if (matchingTaskIds.length === 0) {
            // Nothing to wait for: resolve immediately so trash-task can
            // proceed without blocking.
            resolver();
          } else {
            // Wait for every matching taskBrowser.stopped before resolving.
            enqueue.assign({
              pendingBrowserReapResolvers: () => {
                const next = new Map(context.pendingBrowserReapResolvers);
                let remaining = matchingTaskIds.length;
                const onceAll = () => {
                  remaining -= 1;
                  if (remaining === 0) {
                    resolver();
                  }
                };
                for (const sd of matchingTaskIds) {
                  const existing = next.get(sd) ?? [];
                  next.set(sd, [...existing, onceAll]);
                }
                return next;
              },
            });
          }
        }

        enqueue.raise({
          type: "stopRuntime",
          value: {
            id: event.value.id,
            includeChildren: true,
          },
        });
        enqueue.raise({
          type: "stopSessions",
          value: { id: event.value.id },
        });
      }),
    },
    registerBrowserTarget: {
      actions: {
        params: ({ event }) => ({ event: "registerTarget", ...event.value }),
        type: "forwardToTaskBrowser",
      },
    },
    releaseBrowserPresence: {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "releaseBrowserPresence",
      },
    },
    removeTaskBeingTrashed: {
      actions: assign(({ context, event }) => {
        return {
          tasksBeingTrashed: context.tasksBeingTrashed.filter(
            (id) => id !== event.value.id,
          ),
        };
      }),
    },
    restartAllRuntimes: {
      actions: ({ context }) => {
        for (const runtimeRef of context.runtimeRefs.values()) {
          runtimeRef.send({ type: "restart" });
        }
      },
    },
    restartRuntime: [
      {
        actions: ({ context, event }) => {
          const { id } = event.value;
          const runtimeRef = context.runtimeRefs.get(id);
          runtimeRef?.send({ type: "restart" });
        },
        guard: ({ context, event }) => {
          const { id } = event.value;
          return context.runtimeRefs.has(id);
        },
      },
      {
        actions: raise(({ event }) => {
          const { id } = event.value;
          const taskId = id;
          return {
            type: "spawnRuntime",
            value: { taskId },
          };
        }),
        guard: ({ context, event }) => {
          const { id } = event.value;
          return !context.runtimeRefs.has(id);
        },
      },
    ],
    runTurn: [
      {
        actions: ({ context, event }) => {
          findLiveSessionRef(context, event.value)?.send({ type: "runTurn" });
        },
        guard: ({ context, event }) =>
          findLiveSessionRef(context, event.value) !== undefined,
      },
      {
        actions: raise(({ event }) => ({
          type: "internal.spawnSession",
          value: {
            agentName: event.value.agentName,
            model: event.value.model,
            runRequested: true,
            sessionId: event.value.sessionId,
            taskId: event.value.id,
          },
        })),
      },
    ],
    "session.done": {
      actions: enqueueActions(({ context, enqueue, event }) => {
        // The task's turn is done once its root session finishes; subagent
        // completions don't count (the parent turn is still running). Keying on
        // the root session avoids depending on every session ref reaching a
        // non-alive state, which a lingering subagent ref could block forever.
        if (event.value.parentSessionId === undefined) {
          enqueue({
            params: { id: event.value.taskId },
            type: "markTaskUnread",
          });
        }

        if (
          // Only restart if non-read-only tools were used
          event.value.usedNonReadOnlyTools &&
          // Don't restart the runtime if it isn't running
          context.runtimeRefs.has(event.value.taskId)
        ) {
          enqueue.raise({
            type: "restartRuntime",
            value: { id: event.value.taskId },
          });
        }

        // Drop the finished session's ref so the task stops counting as active.
        // Later messages resolve their session from persisted store state and
        // the runtime ref, so nothing reads a done ref.
        enqueue({
          params: {
            actorId: event.value.actorId,
            id: event.value.taskId,
          },
          type: "dropSessionRef",
        });
      }),
    },
    "session.spawnSubAgent": {
      actions: raise(({ event }) => ({
        type: "internal.spawnSession" as const,
        value: event.value,
      })),
    },
    spawnRuntime: {
      actions: assign(({ context, event, spawn }) => {
        return {
          runtimeRefs: new Map(context.runtimeRefs).set(
            event.value.taskId,
            spawn("runtimeMachine", {
              input: {
                taskId: event.value.taskId,
              },
            }),
          ),
        };
      }),
      guard: ({ context, event }) => {
        const id = event.value.taskId;
        return !context.tasksBeingTrashed.includes(id);
      },
    },
    stopRuntime: {
      actions: enqueueActions(
        ({
          context,
          enqueue,
          event: {
            value: { id, includeChildren },
          },
        }) => {
          enqueue({
            params: { id },
            type: "stopRuntime",
          });
          if (includeChildren) {
            for (const [runtimeTaskId] of context.runtimeRefs.entries()) {
              if (runtimeTaskId === id) {
                enqueue({
                  params: { id: runtimeTaskId },
                  type: "stopRuntime",
                });
              }
            }
          }
        },
      ),
    },
    stopSessions: {
      actions: ({ context, event }) => {
        const sessionActorRefs = context.sessionRefsByTaskId.get(
          event.value.id,
        );
        if (sessionActorRefs) {
          for (const sessionActorRef of sessionActorRefs) {
            sessionActorRef.send({ type: "stop" });
          }
        }
      },
    },

    "taskBrowser.stopped": {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "handleTaskBrowserStopped",
      },
    },

    updateInteractiveToolCall: [
      {
        actions: ({ context, event }) => {
          const id = event.value.id;
          const sessionRefs = context.sessionRefsByTaskId.get(id);
          if (!sessionRefs) {
            return;
          }
          for (const sessionRef of sessionRefs) {
            // TODO: Don't send to all sessions, just the one that has the tool call
            sessionRef.send({
              type: "updateInteractiveToolCall",
              value: event.value.update,
            });
          }
        },
        guard: ({ context, event }) => {
          const id = event.value.id;
          const sessionRefs = context.sessionRefsByTaskId.get(id);
          return !!sessionRefs && sessionRefs.length > 0;
        },
      },
      {
        actions: log(({ event }) => {
          return `No session refs found for id: ${event.value.id}`;
        }),
      },
    ],

    "workspaceServer.attachAgentSession": {
      actions: {
        params: ({ event }) => ({
          id: event.value.id,
          sessionId: event.value.sessionId,
        }),
        type: "forwardAttachAgentSession",
      },
    },

    "workspaceServer.error": {
      actions: log(({ event }) => {
        return `Workspace server error: ${event.value.error.message}`;
      }),
    },

    "workspaceServer.heartbeat": {
      actions: raise(({ event }) => {
        return {
          type: "heartbeat",
          value: event.value,
        };
      }),
    },

    "workspaceServer.started": {
      actions: [
        log(({ event }) => {
          return `Workspace server started on port ${event.value.port}`;
        }),
      ],
    },

    "workspaceServer.updateCdpHeartbeat": {
      actions: {
        params: ({ event }) => ({
          event: "updateCdpHeartbeat",
          id: event.value.id,
          partitionDir: event.value.partitionDir,
          sessionId: event.value.sessionId,
          targetId: event.value.targetId,
        }),
        type: "forwardToTaskBrowser",
      },
    },
  },
  states: {
    Running: {},
  },
});

export type WorkspaceActorRef = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
