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

import { instrumentAgent } from "../../agents/instrument";
import { APPS_DIR_NAME, CHATS_DIR_NAME, TASKS_DIR_NAME } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import { createAssignEventError } from "../../lib/assign-event-error";
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
import { type ChatId } from "../../schemas/chat-id";
import { type WebSearchClient } from "../../schemas/web-search";
import {
  type BrowserConfig,
  type BrowserTargetId,
  type WorkspaceAppsConfig,
  type WorkspaceConfig,
} from "../../types";
import { type ToolCallUpdate } from "../agent";
import {
  type SessionActorRef,
  sessionMachine,
  type SessionMachineParentEvent,
} from "../session";
import {
  type BrowserPresenceLevel,
  chatBrowserMachine,
  type ChatBrowserParentEvent,
} from "../chat-browser";
import { type WorkspaceContext } from "./types";

export type WorkspaceEvent =
  | SessionMachineParentEvent
  | ChatBrowserParentEvent
  | WorkspaceServerParentEvent
  | {
      type: "acquireBrowserPresence";
      value: { id: ChatId; level: BrowserPresenceLevel };
    }
  | {
      type: "addMessage";
      value: {
        id: ChatId;
        /** Stop the step in flight so the message runs as the next turn. */
        interrupt?: boolean;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        /** Already in the store, so the session shows it now and never writes it again. */
        saved?: boolean;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "createSession";
      value: {
        id: ChatId;
        message: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "internal.spawnSession";
      value: {
        // Absent for a turn that runs over what the session already holds.
        message?: SessionMessage.UserWithParts;
        model: AIGatewayModel.Type;
        runRequested?: boolean;
        /** The message is already in the store; see `addMessage`. */
        saved?: boolean;
        sessionId: StoreId.Session;
        chatId: ChatId;
      };
    }
  | {
      type: "prepareToTrashChat";
      value: { id: ChatId; onBrowserReaped?: () => void };
    }
  | {
      type: "registerBrowserTarget";
      value: {
        id: ChatId;
        partitionDir: AbsolutePath;
        sessionId: StoreId.Session;
        targetId: BrowserTargetId;
      };
    }
  | {
      type: "releaseBrowserPresence";
      value: { id: ChatId; level: BrowserPresenceLevel };
    }
  | { type: "removeChatBeingTrashed"; value: { id: ChatId } }
  | {
      type: "runTurn";
      value: {
        id: ChatId;
        model: AIGatewayModel.Type;
        sessionId: StoreId.Session;
      };
    }
  | {
      type: "stopSessions";
      /** Every session of the record, or the one named. */
      value: { id: ChatId; sessionId?: StoreId.Session };
    }
  | {
      type: "updateInteractiveToolCall";
      value: {
        id: ChatId;
        update: ToolCallUpdate;
      };
    };

// The session actor for a task, while it still has a turn to run. A session
// that finished dropped its ref, so anything asking for another turn spawns a
// fresh actor over the same stored session rather than reaching for this one.
function findLiveSessionRef(
  context: WorkspaceContext,
  { id, sessionId }: { id: ChatId; sessionId: StoreId.Session },
) {
  return context.sessionRefsByChatId
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
      (
        { enqueue },
        { id, level }: { id: ChatId; level: BrowserPresenceLevel },
      ) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.chatBrowserRefs.get(id);
          const ref =
            existing ??
            spawn("chatBrowserMachine", {
              input: {
                browser: context.config.browser,
                id,
              },
            });
          ref.send({ type: "acquirePresence", value: { level } });
          if (existing) {
            return {};
          }
          return {
            chatBrowserRefs: new Map(context.chatBrowserRefs).set(id, ref),
          };
        });
      },
    ),

    assignEventError: createAssignEventError(),

    clearSessionRefsByChatId: assign(({ context }, { id }: { id: ChatId }) => {
      const nextSessionRefs = new Map<ChatId, SessionActorRef[]>();

      for (const [
        sessionChatId,
        refs,
      ] of context.sessionRefsByChatId.entries()) {
        const shouldRemove = sessionChatId === id;

        if (shouldRemove) {
          continue;
        }

        nextSessionRefs.set(sessionChatId, refs);
      }

      return {
        sessionRefsByChatId: nextSessionRefs,
      };
    }),

    forwardAttachAgentSession: enqueueActions(
      (
        { context },
        { id, sessionId }: { id: ChatId; sessionId: StoreId.Session },
      ) => {
        const ref = context.chatBrowserRefs.get(id);
        ref?.send({
          type: "attachAgentSession",
          value: { sessionId },
        });
      },
    ),

    // Get-or-spawn the chat's browser machine and forward a target event to it.
    // The user-open (`registerTarget`) and agent CDP (`updateCdpHeartbeat`) paths
    // carry the same payload and differ only in which event the ref receives;
    // the ref decides how each affects its liveness state.
    forwardToChatBrowser: enqueueActions(
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
          id: ChatId;
          partitionDir: AbsolutePath;
          sessionId: StoreId.Session;
          targetId: BrowserTargetId;
        },
      ) => {
        enqueue.assign(({ context, spawn }) => {
          const existing = context.chatBrowserRefs.get(id);
          const ref =
            existing ??
            spawn("chatBrowserMachine", {
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
            chatBrowserRefs: new Map(context.chatBrowserRefs).set(id, ref),
          };
        });
      },
    ),

    handleChatBrowserStopped: enqueueActions(
      ({ context, enqueue }, { id }: { id: ChatId }) => {
        const ref = context.chatBrowserRefs.get(id);
        if (ref) {
          enqueue.stopChild(ref);
        }
        const nextRefs = new Map(context.chatBrowserRefs);
        nextRefs.delete(id);
        enqueue.assign({ chatBrowserRefs: nextRefs });

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

    dropSessionRef: assign(
      ({ context }, { actorId, id }: { actorId: string; id: ChatId }) => {
        const existingSessionActorRefs = context.sessionRefsByChatId.get(id);
        if (!existingSessionActorRefs) {
          return {};
        }

        const remaining = existingSessionActorRefs.filter(
          (ref) => ref.id !== actorId,
        );

        const newSessionRefsByChatId = new Map(context.sessionRefsByChatId);
        if (remaining.length > 0) {
          newSessionRefsByChatId.set(id, remaining);
        } else {
          newSessionRefsByChatId.delete(id);
        }

        return {
          sessionRefsByChatId: newSessionRefsByChatId,
        };
      },
    ),

    releaseBrowserPresence: enqueueActions(
      (
        { context },
        { id, level }: { id: ChatId; level: BrowserPresenceLevel },
      ) => {
        context.chatBrowserRefs
          .get(id)
          ?.send({ type: "releasePresence", value: { level } });
      },
    ),

    trackSessionRef: assign(
      (
        { context },
        {
          id,
          sessionRef,
        }: {
          id: ChatId;
          sessionRef: SessionActorRef;
        },
      ) => {
        const existingSessionActorRefs =
          context.sessionRefsByChatId.get(id) ?? [];

        const activeSessionActorRefs = existingSessionActorRefs.filter(
          (ref) => ref.getSnapshot().status !== "done",
        );

        const newSessionRefsByChatId = new Map(context.sessionRefsByChatId);
        newSessionRefsByChatId.set(id, [...activeSessionActorRefs, sessionRef]);

        return {
          sessionRefsByChatId: newSessionRefsByChatId,
        };
      },
    ),
  },

  actors: {
    sessionMachine,

    chatBrowserMachine,

    workspaceServerLogic,
  },

  types: {
    context: {} as WorkspaceContext,
    events: {} as WorkspaceEvent,
    input: {} as {
      aiGatewayApp: AIGatewayApp;
      apps: WorkspaceAppsConfig;
      appVersion: string;
      browser: BrowserConfig;
      captureEvent: CaptureEventFunction;
      captureException: CaptureExceptionFunction;
      chatTemplateDir: string;
      ensureOutputFolderIcon?: WorkspaceConfig["ensureOutputFolderIcon"];
      getAIProviderConfigs: GetProviderConfigs;
      getUser?: WorkspaceConfig["getUser"];
      indexesDir?: string;
      isExternalBrowserEnabled: () => boolean;
      modelCache: ModelCache;
      nodeExecEnv: Record<string, string>;
      pnpmBinPath: string;
      preparedSkillsDir: string;
      refreshExpiredCredentials?: WorkspaceConfig["refreshExpiredCredentials"];
      registryDir: string;
      rootDir: string;
      systemSkillsDir: string;
      trashItem: (path: AbsolutePath) => Promise<void>;
      uvBinPath: string;
      uvDataDir: string;
      macHelperBinPath?: string;
      knownFolders?: WorkspaceConfig["knownFolders"];
      webSearch: WebSearchClient;
    },
    output: {},
  },
}).createMachine({
  context: ({ input, self, spawn }) => {
    const rootDir = WorkspaceDirSchema.parse(input.rootDir);
    const workspaceConfig: WorkspaceConfig = {
      apps: input.apps,
      appsDir: absolutePathJoin(rootDir, APPS_DIR_NAME),
      appVersion: input.appVersion,
      browser: input.browser,
      captureEvent: input.captureEvent,
      captureException: input.captureException,
      chatTemplateDir: AbsolutePathSchema.parse(
        input.chatTemplateDir,
      ),
      getAIProviderConfigs: input.getAIProviderConfigs,
      ...(input.ensureOutputFolderIcon
        ? { ensureOutputFolderIcon: input.ensureOutputFolderIcon }
        : {}),
      ...(input.getUser ? { getUser: input.getUser } : {}),
      isExternalBrowserEnabled: input.isExternalBrowserEnabled,
      ...(input.knownFolders ? { knownFolders: input.knownFolders } : {}),
      ...(input.indexesDir && {
        indexesDir: AbsolutePathSchema.parse(input.indexesDir),
      }),
      modelCache: input.modelCache,
      nodeExecEnv: input.nodeExecEnv,
      pnpmBinPath: AbsolutePathSchema.parse(input.pnpmBinPath),
      preparedSkillsDir: AbsolutePathSchema.parse(input.preparedSkillsDir),
      ...(input.refreshExpiredCredentials
        ? { refreshExpiredCredentials: input.refreshExpiredCredentials }
        : {}),
      registryDir: AbsolutePathSchema.parse(input.registryDir),
      rootDir,
      systemSkillsDir: AbsolutePathSchema.parse(input.systemSkillsDir),
      chatsDir: absolutePathJoin(rootDir, CHATS_DIR_NAME),
      legacyTasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
      trashItem: input.trashItem,
      uvBinPath: AbsolutePathSchema.parse(input.uvBinPath),
      ...(input.macHelperBinPath === undefined
        ? {}
        : {
            macHelperBinPath: AbsolutePathSchema.parse(input.macHelperBinPath),
          }),
      uvDataDir: AbsolutePathSchema.parse(input.uvDataDir),
      webSearch: input.webSearch,
    };
    // Publish the single per-process config so code can read it via
    // getWorkspaceConfig() instead of threading it through every ChatId.
    setWorkspaceConfig(workspaceConfig);
    return {
      config: workspaceConfig,
      pendingBrowserReapResolvers: new Map(),
      sessionRefsByChatId: new Map(),
      chatBrowserRefs: new Map(),
      chatsBeingTrashed: [],
      workspaceServerRef: spawn("workspaceServerLogic", {
        input: {
          aiGatewayApp: input.aiGatewayApp,
          parentRef: self,
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
        params: ({ event }) => event.value,
        type: "acquireBrowserPresence",
      },
    },
    addMessage: [
      {
        actions: ({ context, event }) => {
          const targetRef = findLiveSessionRef(context, event.value);
          targetRef?.send({
            interrupt: event.value.interrupt,
            model: event.value.model,
            saved: event.value.saved,
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
          const chatId = id;
          return {
            type: "internal.spawnSession",
            value: {
              message: event.value.message,
              model: event.value.model,
              saved: event.value.saved,
              sessionId: event.value.sessionId,
              chatId,
            },
          };
        }),
      },
    ],
    createSession: {
      actions: raise(({ event }) => {
        const chatId = event.value.id;
        return {
          type: "internal.spawnSession",
          value: {
            message: event.value.message,
            model: event.value.model,
            sessionId: event.value.sessionId,
            chatId,
          },
        };
      }),
    },
    "internal.spawnSession": {
      actions: enqueueActions(({ enqueue, event, self }) => {
        enqueue.assign(({ spawn }) => {
          const { message, model, runRequested, saved, sessionId, chatId } =
            event.value;

          const sessionMachineRef = spawn("sessionMachine", {
            input: {
              agent: instrumentAgent,
              baseLLMRetryDelayMs: ms("1 second"),
              llmRequestChunkTimeoutMs: ms("5 minutes"),
              model,
              parentRef: self,
              queuedMessages: message ? [message] : [],
              runRequested,
              savedMessageIds: saved && message ? [message.id] : [],
              sessionId,
              chatId,
            },
          });

          enqueue({
            params: {
              id: chatId,
              sessionRef: sessionMachineRef,
            },
            type: "trackSessionRef",
          });

          return {};
        });
      }),
      guard: ({ context, event }) => {
        const id = event.value.chatId;
        return !context.chatsBeingTrashed.includes(id);
      },
    },
    prepareToTrashChat: {
      actions: enqueueActions(({ context, enqueue, event }) => {
        enqueue.assign({
          chatsBeingTrashed: [...context.chatsBeingTrashed, event.value.id],
        });

        // Reap the trashed chat's chatBrowser, if one exists.
        const matchingChatIds: ChatId[] = [];
        const browserRef = context.chatBrowserRefs.get(event.value.id);
        if (browserRef) {
          matchingChatIds.push(event.value.id);
          browserRef.send({ type: "forceReap" });
        }

        if (event.value.onBrowserReaped) {
          const resolver = event.value.onBrowserReaped;
          if (matchingChatIds.length === 0) {
            // Nothing to wait for: resolve immediately so trashChat can
            // proceed without blocking.
            resolver();
          } else {
            // Wait for every matching chatBrowser.stopped before resolving.
            enqueue.assign({
              pendingBrowserReapResolvers: () => {
                const next = new Map(context.pendingBrowserReapResolvers);
                let remaining = matchingChatIds.length;
                const onceAll = () => {
                  remaining -= 1;
                  if (remaining === 0) {
                    resolver();
                  }
                };
                for (const sd of matchingChatIds) {
                  const existing = next.get(sd) ?? [];
                  next.set(sd, [...existing, onceAll]);
                }
                return next;
              },
            });
          }
        }

        enqueue.raise({
          type: "stopSessions",
          value: { id: event.value.id },
        });
      }),
    },
    registerBrowserTarget: {
      actions: {
        params: ({ event }) => ({ event: "registerTarget", ...event.value }),
        type: "forwardToChatBrowser",
      },
    },
    releaseBrowserPresence: {
      actions: {
        params: ({ event }) => event.value,
        type: "releaseBrowserPresence",
      },
    },
    removeChatBeingTrashed: {
      actions: assign(({ context, event }) => {
        return {
          chatsBeingTrashed: context.chatsBeingTrashed.filter(
            (id) => id !== event.value.id,
          ),
        };
      }),
    },
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
            model: event.value.model,
            runRequested: true,
            sessionId: event.value.sessionId,
            chatId: event.value.id,
          },
        })),
      },
    ],
    "session.done": {
      actions: enqueueActions(({ enqueue, event }) => {
        // Drop the finished session's ref so the task stops counting as active.
        // Later messages resolve their session from persisted store state, so
        // nothing reads a done ref.
        enqueue({
          params: {
            actorId: event.value.actorId,
            id: event.value.chatId,
          },
          type: "dropSessionRef",
        });
      }),
    },
    stopSessions: {
      actions: ({ context, event }) => {
        const sessionActorRefs = context.sessionRefsByChatId.get(
          event.value.id,
        );
        const { sessionId } = event.value;
        for (const sessionActorRef of sessionActorRefs ?? []) {
          if (
            sessionId === undefined ||
            sessionActorRef.getSnapshot().context.sessionId === sessionId
          ) {
            sessionActorRef.send({ type: "stop" });
          }
        }
      },
    },

    "chatBrowser.stopped": {
      actions: {
        params: ({ event }) => ({ id: event.value.id }),
        type: "handleChatBrowserStopped",
      },
    },

    updateInteractiveToolCall: [
      {
        actions: ({ context, event }) => {
          const id = event.value.id;
          const sessionRefs = context.sessionRefsByChatId.get(id);
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
          const sessionRefs = context.sessionRefsByChatId.get(id);
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
        type: "forwardToChatBrowser",
      },
    },
  },
  states: {
    Running: {},
  },
});

export type WorkspaceActorRef = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
