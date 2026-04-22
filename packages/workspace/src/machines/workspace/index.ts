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
import invariant from "tiny-invariant";
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
import { closeAllAgentBrowserSessions } from "../../lib/agent-browser-cleanup";
import { createAppConfig } from "../../lib/app-config/create";
import { type AppConfig } from "../../lib/app-config/types";
import { createAssignEventError } from "../../lib/assign-event-error";
import { isProjectSubdomain } from "../../lib/is-app";
import { logUnhandledEvent } from "../../lib/log-unhandled-event";
import {
  checkoutVersionLogic,
  type CheckoutVersionParentEvent,
} from "../../logic/checkout-version";
import {
  createPreviewLogic,
  type CreatePreviewParentEvent,
} from "../../logic/create-preview";
import { workspaceServerLogic } from "../../logic/server";
import { type WorkspaceServerParentEvent } from "../../logic/server/types";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import {
  type AppSubdomain,
  type ProjectSubdomain,
} from "../../schemas/subdomains";
import {
  type BrowserConfig,
  type BrowserTargetId,
  type WorkspaceConfig,
} from "../../types";
import { type ToolCallUpdate } from "../agent";
import {
  projectBrowserMachine,
  type ProjectBrowserParentEvent,
} from "../project-browser";
import { runtimeMachine } from "../runtime";
import {
  type SessionActorRef,
  sessionMachine,
  type SessionMachineParentEvent,
} from "../session";
import { type WorkspaceContext } from "./types";

export type WorkspaceEvent =
  | CheckoutVersionParentEvent
  | CreatePreviewParentEvent
  | ProjectBrowserParentEvent
  | SessionMachineParentEvent
  | WorkspaceServerParentEvent
  | {
      type: "addMessage";
      value: {
        agentName: AgentName;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
        subdomain: AppSubdomain;
      };
    }
  | {
      type: "createSession";
      value: {
        agentName: AgentName;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
        subdomain: AppSubdomain;
      };
    }
  | {
      type: "heartbeat";
      value: {
        appConfig: AppConfig;
        createdAt: number;
        shouldCreate: boolean;
      };
    }
  | {
      type: "internal.spawnSession";
      value: {
        agentName: AgentName;
        appConfig: AppConfig;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        parentSessionId?: StoreId.Session;
        sessionId: StoreId.Session;
        sessionNamePrefix?: string;
      };
    }
  | {
      type: "internal.updateHeartbeat";
      value: { createdAt: number; subdomain: AppSubdomain };
    }
  | {
      type: "prepareToTrashApp";
      value: { onBrowserReaped?: () => void; subdomain: AppSubdomain };
    }
  | { type: "removeAppBeingTrashed"; value: { subdomain: AppSubdomain } }
  | {
      type: "restartAllRuntimes";
    }
  | {
      type: "restartRuntime";
      value: { subdomain: AppSubdomain };
    }
  | {
      type: "spawnRuntime";
      value: { appConfig: AppConfig };
    }
  | {
      type: "stopRuntime";
      value: {
        includeChildren?: boolean;
        subdomain: AppSubdomain;
      };
    }
  | {
      type: "stopSessions";
      value: { subdomain: AppSubdomain };
    }
  | {
      type: "updateInteractiveToolCall";
      value: {
        subdomain: AppSubdomain;
        update: ToolCallUpdate;
      };
    }
  | {
      type: "updateUserHeartbeat";
      value: { subdomain: ProjectSubdomain };
    };

export const workspaceMachine = setup({
  actions: {
    assignEventError: createAssignEventError(),

    cleanupAgentBrowserSessions: enqueueActions(() => {
      void closeAllAgentBrowserSessions();
    }),

    clearSessionRefsBySubdomain: assign(
      ({ context }, { subdomain }: { subdomain: AppSubdomain }) => {
        const newsessionRefsBySubdomain = new Map<
          AppSubdomain,
          SessionActorRef[]
        >();

        for (const [
          sessionSubdomain,
          refs,
        ] of context.sessionRefsBySubdomain.entries()) {
          const shouldRemove =
            sessionSubdomain === subdomain ||
            (isProjectSubdomain(subdomain) &&
              sessionSubdomain.endsWith(subdomain));

          if (shouldRemove) {
            continue;
          }

          newsessionRefsBySubdomain.set(sessionSubdomain, refs);
        }

        return {
          sessionRefsBySubdomain: newsessionRefsBySubdomain,
        };
      },
    ),

    forwardAttachAgentSession: enqueueActions(
      (
        { context },
        {
          sessionId,
          subdomain,
        }: { sessionId: StoreId.Session; subdomain: ProjectSubdomain },
      ) => {
        const ref = context.projectBrowserRefs.get(subdomain);
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
          partitionDir,
          sessionId,
          subdomain,
          targetId,
        }: {
          partitionDir: AbsolutePath;
          sessionId: StoreId.Session;
          subdomain: ProjectSubdomain;
          targetId: BrowserTargetId;
        },
      ) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.projectBrowserRefs.get(subdomain);
          const ref =
            existing ??
            spawn("projectBrowserMachine", {
              input: { browser: context.config.browser, subdomain },
            });
          ref.send({
            type: "updateCdpHeartbeat",
            value: { partitionDir, sessionId, targetId },
          });
          if (existing) {
            return {};
          }
          return {
            projectBrowserRefs: new Map(context.projectBrowserRefs).set(
              subdomain,
              ref,
            ),
          };
        });
      },
    ),

    forwardUpdateHeartbeat: enqueueActions(
      (
        { context },
        {
          createdAt,
          subdomain,
        }: { createdAt: number; subdomain: AppSubdomain },
      ) => {
        const runtimeRef = context.runtimeRefs.get(subdomain);
        runtimeRef?.send({
          type: "updateHeartbeat",
          value: { createdAt },
        });
      },
    ),

    forwardUpdateUserHeartbeat: enqueueActions(
      ({ enqueue }, { subdomain }: { subdomain: ProjectSubdomain }) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.projectBrowserRefs.get(subdomain);
          const ref =
            existing ??
            spawn("projectBrowserMachine", {
              input: { browser: context.config.browser, subdomain },
            });
          ref.send({ type: "updateUserHeartbeat" });
          if (existing) {
            return {};
          }
          return {
            projectBrowserRefs: new Map(context.projectBrowserRefs).set(
              subdomain,
              ref,
            ),
          };
        });
      },
    ),

    handleProjectBrowserStopped: enqueueActions(
      (
        { context, enqueue },
        { subdomain }: { subdomain: ProjectSubdomain },
      ) => {
        const ref = context.projectBrowserRefs.get(subdomain);
        if (ref) {
          enqueue.stopChild(ref);
        }
        const nextRefs = new Map(context.projectBrowserRefs);
        nextRefs.delete(subdomain);
        enqueue.assign({ projectBrowserRefs: nextRefs });

        const resolvers = context.pendingBrowserReapResolvers.get(subdomain);
        if (resolvers && resolvers.length > 0) {
          for (const resolve of resolvers) {
            resolve();
          }
          const nextResolvers = new Map(context.pendingBrowserReapResolvers);
          nextResolvers.delete(subdomain);
          enqueue.assign({ pendingBrowserReapResolvers: nextResolvers });
        }
      },
    ),

    stopRuntime: enqueueActions(
      ({ context, enqueue }, { subdomain }: { subdomain: AppSubdomain }) => {
        const runtimeRef = context.runtimeRefs.get(subdomain);
        const remainingRefs = new Map(context.runtimeRefs);
        remainingRefs.delete(subdomain);
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
          sessionRef,
          subdomain,
        }: {
          sessionRef: SessionActorRef;
          subdomain: AppSubdomain;
        },
      ) => {
        const existingSessionActorRefs =
          context.sessionRefsBySubdomain.get(subdomain) ?? [];

        const activeSessionActorRefs = existingSessionActorRefs.filter(
          (ref) => ref.getSnapshot().status !== "done",
        );

        const newSessionRefsBySubdomain = new Map(
          context.sessionRefsBySubdomain,
        );
        newSessionRefsBySubdomain.set(subdomain, [
          ...activeSessionActorRefs,
          sessionRef,
        ]);

        return {
          sessionRefsBySubdomain: newSessionRefsBySubdomain,
        };
      },
    ),
  },

  actors: {
    checkoutVersionLogic,

    createPreviewLogic,

    projectBrowserMachine,

    runtimeMachine,

    sessionMachine,

    workspaceServerLogic,
  },

  types: {
    context: {} as WorkspaceContext,
    events: {} as WorkspaceEvent,
    input: {} as {
      aiGatewayApp: AIGatewayApp;
      browser: BrowserConfig;
      captureEvent: CaptureEventFunction;
      captureException: CaptureExceptionFunction;
      getAIProviderConfigs: GetProviderConfigs;
      nodeExecEnv: Record<string, string>;
      pnpmBinPath: string;
      previewCacheTimeMs?: number;
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
      browser: input.browser,
      captureEvent: input.captureEvent,
      captureException: input.captureException,
      getAIProviderConfigs: input.getAIProviderConfigs,
      nodeExecEnv: input.nodeExecEnv,
      pnpmBinPath: AbsolutePathSchema.parse(input.pnpmBinPath),
      previewCacheTimeMs: input.previewCacheTimeMs,
      previewsDir: absolutePathJoin(rootDir, "previews"),
      projectsDir: absolutePathJoin(rootDir, "projects"),
      registryDir: AbsolutePathSchema.parse(input.registryDir),
      rootDir,
      templatesDir: absolutePathJoin(
        registryDir,
        REGISTRY_FOLDER_NAMES.templates,
      ),
      trashItem: input.trashItem,
    };
    return {
      appsBeingTrashed: [],
      checkoutVersionRefs: new Map(),
      config: workspaceConfig,
      createPreviewRefs: new Map(),
      pendingBrowserReapResolvers: new Map(),
      projectBrowserRefs: new Map(),
      runtimeRefs: new Map(),
      sessionRefsBySubdomain: new Map(),
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
    addMessage: [
      {
        actions: ({ context, event }) => {
          const subdomain = event.value.subdomain;
          const sessionRefs = context.sessionRefsBySubdomain.get(subdomain);

          // Send to existing session
          if (sessionRefs) {
            for (const sessionRef of sessionRefs) {
              sessionRef.send({
                type: "addMessage",
                value: event.value.message,
              });
            }
          }
        },
        guard: ({ context, event }) => {
          const subdomain = event.value.subdomain;
          const sessionRefs = context.sessionRefsBySubdomain.get(subdomain);
          const hasActiveSession = sessionRefs?.some(
            (ref) => ref.getSnapshot().status === "active",
          );
          return Boolean(hasActiveSession);
        },
      },
      {
        actions: raise(({ context, event }) => {
          const subdomain = event.value.subdomain;
          const appConfig = createAppConfig({
            subdomain,
            workspaceConfig: context.config,
          });
          return {
            type: "internal.spawnSession",
            value: {
              agentName: event.value.agentName,
              appConfig,
              message: event.value.message,
              model: event.value.model,
              sessionId: event.value.sessionId,
            },
          };
        }),
      },
    ],
    "checkoutVersion.done": {
      actions: assign(({ context, event }) => {
        const subdomain = event.value.appConfig.subdomain;
        const checkoutVersionRefs = new Map(context.checkoutVersionRefs);
        checkoutVersionRefs.delete(subdomain);
        return {
          checkoutVersionRefs,
        };
      }),
    },
    "createPreview.done": {
      actions: assign(({ context, event }) => {
        const subdomain = event.value.appConfig.subdomain;
        const createPreviewRefs = new Map(context.createPreviewRefs);
        createPreviewRefs.delete(subdomain);
        return { createPreviewRefs };
      }),
    },
    createSession: {
      actions: raise(({ context, event }) => {
        const appConfig = createAppConfig({
          subdomain: event.value.subdomain,
          workspaceConfig: context.config,
        });
        return {
          type: "internal.spawnSession",
          value: {
            agentName: event.value.agentName,
            appConfig,
            message: event.value.message,
            model: event.value.model,
            sessionId: event.value.sessionId,
          },
        };
      }),
    },
    heartbeat: [
      {
        actions: assign({
          createPreviewRefs: ({ context, event, self, spawn }) => {
            invariant(
              event.value.appConfig.type === "preview",
              "Expected preview app config",
            );
            const appConfig = event.value.appConfig;

            if (context.createPreviewRefs.has(appConfig.subdomain)) {
              // Already creating a preview for this app
              return context.createPreviewRefs;
            }

            const createPreviewRef = spawn("createPreviewLogic", {
              input: {
                appConfig,
                parentRef: self,
              },
            });

            return new Map(context.createPreviewRefs).set(
              appConfig.subdomain,
              createPreviewRef,
            );
          },
        }),
        guard: ({ event }) =>
          event.value.shouldCreate && event.value.appConfig.type === "preview",
      },
      {
        actions: assign({
          checkoutVersionRefs: ({ context, event, self, spawn }) => {
            invariant(
              event.value.appConfig.type === "version",
              "Expected version app config",
            );
            const appConfig = event.value.appConfig;

            if (context.checkoutVersionRefs.has(appConfig.subdomain)) {
              // Already creating a version for this app
              return context.checkoutVersionRefs;
            }

            const checkoutVersionRef = spawn("checkoutVersionLogic", {
              input: {
                appConfig,
                parentRef: self,
              },
            });

            return new Map(context.checkoutVersionRefs).set(
              appConfig.subdomain,
              checkoutVersionRef,
            );
          },
        }),
        guard: ({ event }) =>
          event.value.shouldCreate && event.value.appConfig.type === "version",
      },
      {
        actions: raise(({ context, event }) => {
          const existingRuntimeRef = context.runtimeRefs.get(
            event.value.appConfig.subdomain,
          );

          if (existingRuntimeRef) {
            return {
              type: "internal.updateHeartbeat",
              value: {
                createdAt: event.value.createdAt,
                subdomain: event.value.appConfig.subdomain,
              },
            };
          }

          return {
            type: "spawnRuntime",
            value: {
              appConfig: event.value.appConfig,
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
            appConfig,
            message,
            model,
            parentSessionId,
            sessionId,
            sessionNamePrefix,
          } = event.value;

          const sessionMachineRef = spawn("sessionMachine", {
            input: {
              agent: AGENTS[agentName],
              appConfig,
              baseLLMRetryDelayMs: ms("1 second"),
              llmRequestChunkTimeoutMs: ms("5 minutes"),
              model,
              parentRef: self,
              parentSessionId,
              queuedMessages: [message],
              sessionId,
              sessionNamePrefix,
            },
          });

          enqueue({
            params: {
              sessionRef: sessionMachineRef,
              subdomain: appConfig.subdomain,
            },
            type: "trackSessionRef",
          });

          return {};
        });
      }),
      guard: ({ context, event }) => {
        const { subdomain } = event.value.appConfig;
        return !context.appsBeingTrashed.some(
          (trashingSubdomain) =>
            subdomain === trashingSubdomain ||
            // Includes sandboxes for projects being trashed
            subdomain.endsWith(trashingSubdomain),
        );
      },
    },
    "internal.updateHeartbeat": {
      actions: {
        params: ({ event }) => ({
          createdAt: event.value.createdAt,
          subdomain: event.value.subdomain,
        }),
        type: "forwardUpdateHeartbeat",
      },
    },
    prepareToTrashApp: {
      actions: enqueueActions(({ context, enqueue, event }) => {
        enqueue.assign({
          appsBeingTrashed: [
            ...context.appsBeingTrashed,
            event.value.subdomain,
          ],
        });

        // Track every projectBrowser whose subdomain matches the trashed
        // project (the project itself, plus any sandbox-suffixed entries
        // that happen to share the prefix).
        const matchingSubdomains: ProjectSubdomain[] = [];
        for (const [
          browserSubdomain,
          ref,
        ] of context.projectBrowserRefs.entries()) {
          const matches =
            browserSubdomain === event.value.subdomain ||
            (typeof event.value.subdomain === "string" &&
              browserSubdomain.endsWith(event.value.subdomain));
          if (matches) {
            matchingSubdomains.push(browserSubdomain);
            ref.send({ type: "forceReap" });
          }
        }

        if (event.value.onBrowserReaped) {
          const resolver = event.value.onBrowserReaped;
          if (matchingSubdomains.length === 0) {
            // Nothing to wait for: resolve immediately so trash-project can
            // proceed without blocking.
            resolver();
          } else {
            // Wait for every matching projectBrowser.stopped before resolving.
            enqueue.assign({
              pendingBrowserReapResolvers: () => {
                const next = new Map(context.pendingBrowserReapResolvers);
                let remaining = matchingSubdomains.length;
                const onceAll = () => {
                  remaining -= 1;
                  if (remaining === 0) {
                    resolver();
                  }
                };
                for (const sd of matchingSubdomains) {
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
            includeChildren: true,
            subdomain: event.value.subdomain,
          },
        });
        enqueue.raise({
          type: "stopSessions",
          value: { subdomain: event.value.subdomain },
        });
      }),
    },
    "projectBrowser.stopped": {
      actions: {
        params: ({ event }) => ({ subdomain: event.value.subdomain }),
        type: "handleProjectBrowserStopped",
      },
    },
    removeAppBeingTrashed: {
      actions: assign(({ context, event }) => {
        return {
          appsBeingTrashed: context.appsBeingTrashed.filter(
            (subdomain) => subdomain !== event.value.subdomain,
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
          const { subdomain } = event.value;
          const runtimeRef = context.runtimeRefs.get(subdomain);
          runtimeRef?.send({ type: "restart" });
        },
        guard: ({ context, event }) => {
          const { subdomain } = event.value;
          return context.runtimeRefs.has(subdomain);
        },
      },
      {
        actions: raise(({ context, event }) => {
          const { subdomain } = event.value;
          const appConfig = createAppConfig({
            subdomain,
            workspaceConfig: context.config,
          });
          return {
            type: "spawnRuntime",
            value: { appConfig },
          };
        }),
        guard: ({ context, event }) => {
          const { subdomain } = event.value;
          return !context.runtimeRefs.has(subdomain);
        },
      },
    ],
    "session.done": [
      {
        actions: raise(({ event }) => {
          return {
            type: "restartRuntime",
            value: { subdomain: event.value.appConfig.subdomain },
          };
        }),
        guard: ({ context, event }) =>
          // Only restart if non-read-only tools were used
          event.value.usedNonReadOnlyTools &&
          // Don't restart if the runtime if it isn't running
          context.runtimeRefs.has(event.value.appConfig.subdomain),
      },
      {
        // No restart needed if only read-only tools were used
      },
      // TODO: Add this back once we have another way to show "done" sessions
      // in the UI because we want to garbage collect them eagerly.
      // actions: assign(({ context, event }) => {
      //   const { subdomain } = event.value.appConfig;
      //   const { [subdomain]: sessionActorRefs = [], ...otherRefs } =
      //     context.sessionRefsBySubdomain;
      //   const newSessionActorRefs = sessionActorRefs.filter(
      //     (ref) => ref.id !== event.value.actorId,
      //   );
      //   return {
      //     sessionRefsBySubdomain: {
      //       ...otherRefs,
      //       [subdomain]: newSessionActorRefs,
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
            event.value.appConfig.subdomain,
            spawn("runtimeMachine", {
              input: {
                appConfig: event.value.appConfig,
              },
            }),
          ),
        };
      }),
      guard: ({ context, event }) => {
        const subdomain = event.value.appConfig.subdomain;
        return !context.appsBeingTrashed.some(
          (trashingSubdomain) =>
            subdomain === trashingSubdomain ||
            // Includes sandboxes for projects being trashed
            subdomain.endsWith(trashingSubdomain),
        );
      },
    },
    stopRuntime: {
      actions: enqueueActions(
        ({
          context,
          enqueue,
          event: {
            value: { includeChildren, subdomain },
          },
        }) => {
          enqueue({
            params: { subdomain },
            type: "stopRuntime",
          });
          if (includeChildren) {
            for (const [runtimeSubdomain] of context.runtimeRefs.entries()) {
              if (runtimeSubdomain.includes(subdomain)) {
                enqueue({
                  params: { subdomain: runtimeSubdomain },
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
        const sessionActorRefs = context.sessionRefsBySubdomain.get(
          event.value.subdomain,
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
          const subdomain = event.value.subdomain;
          const sessionRefs = context.sessionRefsBySubdomain.get(subdomain);
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
          const subdomain = event.value.subdomain;
          const sessionRefs = context.sessionRefsBySubdomain.get(subdomain);
          return !!sessionRefs && sessionRefs.length > 0;
        },
      },
      {
        actions: log(({ event }) => {
          return `No session refs found for subdomain: ${event.value.subdomain}`;
        }),
      },
    ],

    updateUserHeartbeat: {
      actions: {
        params: ({ event }) => ({ subdomain: event.value.subdomain }),
        type: "forwardUpdateUserHeartbeat",
      },
    },

    "workspaceServer.attachAgentSession": {
      actions: {
        params: ({ event }) => ({
          sessionId: event.value.sessionId,
          subdomain: event.value.subdomain,
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
          partitionDir: event.value.partitionDir,
          sessionId: event.value.sessionId,
          subdomain: event.value.subdomain,
          targetId: event.value.targetId,
        }),
        type: "forwardUpdateCdpHeartbeat",
      },
    },
  },
  states: {
    Running: {
      entry: [{ type: "cleanupAgentBrowserSessions" }],
      exit: [{ type: "cleanupAgentBrowserSessions" }],
    },
  },
});

export type WorkspaceActorRef = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
