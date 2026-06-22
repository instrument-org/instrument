import {
  type AIGatewayApp,
  type AIGatewayModel,
  type GetProviderConfigs,
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
import { REGISTRY_FOLDER_NAMES } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import { createAssignEventError } from "../../lib/assign-event-error";
import { isTaskId } from "../../lib/is-app";
import { logUnhandledEvent } from "../../lib/log-unhandled-event";
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
import {
  type BrowserConfig,
  type BrowserTargetId,
  type WorkspaceConfig,
} from "../../types";
import { type ToolCallUpdate } from "../agent";
import {
  taskBrowserMachine,
  type TaskBrowserParentEvent,
} from "../task-browser";
import { runtimeMachine } from "../runtime";
import {
  type SessionActorRef,
  sessionMachine,
  type SessionMachineParentEvent,
} from "../session";
import { type WorkspaceContext } from "./types";

export type WorkspaceEvent =
  | TaskBrowserParentEvent
  | SessionMachineParentEvent
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
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        parentSessionId?: StoreId.Session;
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
      type: "prepareToTrashApp";
      value: { id: TaskId; onBrowserReaped?: () => void };
    }
  | {
      type: "releaseBrowserPresence";
      value: { id: TaskId };
    }
  | { type: "removeAppBeingTrashed"; value: { id: TaskId } }
  | {
      type: "restartAllRuntimes";
    }
  | {
      type: "restartRuntime";
      value: { id: TaskId };
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
        const shouldRemove =
          sessionTaskId === id || (isTaskId(id) && sessionTaskId.endsWith(id));

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

    forwardUpdateCdpHeartbeat: enqueueActions(
      (
        { enqueue },
        {
          id,
          partitionDir,
          sessionId,
          targetId,
        }: {
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
            type: "updateCdpHeartbeat",
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
    taskBrowserMachine,

    runtimeMachine,

    sessionMachine,

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
      getAIProviderConfigs: GetProviderConfigs;
      nodeExecEnv: Record<string, string>;
      pnpmBinPath: string;
      registryDir: string;
      rootDir: string;
      shimClientDir: string;
      trashItem: (path: AbsolutePath) => Promise<void>;
    },
    output: {} as { error?: unknown },
  },
}).createMachine({
  context: ({ input, self, spawn }) => {
    const registryDir = AbsolutePathSchema.parse(input.registryDir);
    const rootDir = WorkspaceDirSchema.parse(input.rootDir);
    const workspaceConfig: WorkspaceConfig = {
      appVersion: input.appVersion,
      browser: input.browser,
      captureEvent: input.captureEvent,
      captureException: input.captureException,
      getAIProviderConfigs: input.getAIProviderConfigs,
      nodeExecEnv: input.nodeExecEnv,
      pnpmBinPath: AbsolutePathSchema.parse(input.pnpmBinPath),
      registryDir: AbsolutePathSchema.parse(input.registryDir),
      rootDir,
      tasksDir: absolutePathJoin(rootDir, "projects"),
      templatesDir: absolutePathJoin(
        registryDir,
        REGISTRY_FOLDER_NAMES.templates,
      ),
      trashItem: input.trashItem,
    };
    // Publish the single per-process config so code can read it via
    // getWorkspaceConfig() instead of threading it through every TaskId.
    setWorkspaceConfig(workspaceConfig);
    return {
      appsBeingTrashed: [],
      config: workspaceConfig,
      pendingBrowserReapResolvers: new Map(),
      taskBrowserRefs: new Map(),
      runtimeRefs: new Map(),
      sessionRefsByTaskId: new Map(),
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
          const { id, sessionId } = event.value;
          const sessionRefs = context.sessionRefsByTaskId.get(id);

          const targetRef = sessionRefs?.find(
            (ref) => ref.getSnapshot().context.sessionId === sessionId,
          );
          targetRef?.send({
            type: "addMessage",
            value: event.value.message,
          });
        },
        guard: ({ context, event }) => {
          const { id, sessionId } = event.value;
          const sessionRefs = context.sessionRefsByTaskId.get(id);
          return Boolean(
            sessionRefs?.some(
              (ref) =>
                ref.getSnapshot().context.sessionId === sessionId &&
                ref.getSnapshot().status === "active",
            ),
          );
        },
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
              queuedMessages: [message],
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
        return !context.appsBeingTrashed.some(
          (trashingTaskId) =>
            id === trashingTaskId ||
            // Includes any id nested under the project being trashed
            id.endsWith(trashingTaskId),
        );
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
    prepareToTrashApp: {
      actions: enqueueActions(({ context, enqueue, event }) => {
        enqueue.assign({
          appsBeingTrashed: [...context.appsBeingTrashed, event.value.id],
        });

        // Track every projectBrowser whose id matches the trashed
        // project (the project itself, plus any id nested under it).
        const matchingTaskIds: TaskId[] = [];
        for (const [browserTaskId, ref] of context.taskBrowserRefs.entries()) {
          const matches =
            browserTaskId === event.value.id ||
            (typeof event.value.id === "string" &&
              browserTaskId.endsWith(event.value.id));
          if (matches) {
            matchingTaskIds.push(browserTaskId);
            ref.send({ type: "forceReap" });
          }
        }

        if (event.value.onBrowserReaped) {
          const resolver = event.value.onBrowserReaped;
          if (matchingTaskIds.length === 0) {
            // Nothing to wait for: resolve immediately so trash-project can
            // proceed without blocking.
            resolver();
          } else {
            // Wait for every matching projectBrowser.stopped before resolving.
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
    "taskBrowser.stopped": {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "handleTaskBrowserStopped",
      },
    },
    releaseBrowserPresence: {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "releaseBrowserPresence",
      },
    },
    removeAppBeingTrashed: {
      actions: assign(({ context, event }) => {
        return {
          appsBeingTrashed: context.appsBeingTrashed.filter(
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
    "session.done": [
      {
        actions: raise(({ event }) => {
          return {
            type: "restartRuntime",
            value: { id: event.value.taskId },
          };
        }),
        guard: ({ context, event }) =>
          // Only restart if non-read-only tools were used
          event.value.usedNonReadOnlyTools &&
          // Don't restart if the runtime if it isn't running
          context.runtimeRefs.has(event.value.taskId),
      },
      {
        // No restart needed if only read-only tools were used
      },
      // TODO: Add this back once we have another way to show "done" sessions
      // in the UI because we want to garbage collect them eagerly.
      // actions: assign(({ context, event }) => {
      //   const { id } = event.value.taskId;
      //   const { [id]: sessionActorRefs = [], ...otherRefs } =
      //     context.sessionRefsByTaskId;
      //   const newSessionActorRefs = sessionActorRefs.filter(
      //     (ref) => ref.id !== event.value.actorId,
      //   );
      //   return {
      //     sessionRefsByTaskId: {
      //       ...otherRefs,
      //       [id]: newSessionActorRefs,
      //     },
      //   };
      // }),
    ],
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
        return !context.appsBeingTrashed.some(
          (trashingTaskId) =>
            id === trashingTaskId ||
            // Includes any id nested under the project being trashed
            id.endsWith(trashingTaskId),
        );
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
              if (runtimeTaskId.includes(id)) {
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
          id: event.value.id,
          partitionDir: event.value.partitionDir,
          sessionId: event.value.sessionId,
          targetId: event.value.targetId,
        }),
        type: "forwardUpdateCdpHeartbeat",
      },
    },
  },
  states: {
    Running: {},
  },
});

export type WorkspaceActorRef = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
