import {
  type AIGatewayApp,
  type AIGatewayModel,
  type GetProviderConfigs,
  type ModelCache,
} from "@instrument-org/ai-gateway";
import {
  type CaptureExceptionFunction,
  WORKSPACE_MACHINE_ENTRIES,
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
import { TASKS_DIR_NAME } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import { createAssignEventError } from "../../lib/assign-event-error";
import { logUnhandledEvent } from "../../lib/log-unhandled-event";
import { registerAIUsageTelemetry } from "../../lib/ai-usage/record";
import { sessionOfChat } from "../../lib/record-folders";
import { setWorkspaceConfig } from "../../lib/workspace-config";
import { workspaceLayout } from "../../lib/workspace-layout";
import { workspaceServerLogic } from "../../logic/server";
import { type WorkspaceServerParentEvent } from "../../logic/server/types";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type StopNotice } from "../../schemas/stop-notice";
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
import { type StopReason } from "../execute-tool-call";
import {
  type SessionActorRef,
  sessionMachine,
  type SessionMachineParentEvent,
} from "../session";
import { windowBrowserLogic } from "../window-browser";
import { isDrivenByWorkingAgent } from "../../lib/chat/driven-tabs";
import { type WorkspaceContext } from "./types";

export type WorkspaceEvent =
  | SessionMachineParentEvent
  | WorkspaceServerParentEvent
  | {
      type: "acquireBrowserPresence";
      value: { targetId: BrowserTargetId };
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
      value: { id: ChatId };
    }
  | {
      type: "registerBrowserTarget";
      value: { targetId: BrowserTargetId };
    }
  | {
      type: "releaseBrowserPresence";
      value: { targetId: BrowserTargetId };
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
      /** Every session of the record, or the one named, with whose stop it is and why. */
      value: {
        id: ChatId;
        notice?: StopNotice;
        reason?: StopReason;
        sessionId?: StoreId.Session;
      };
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

/**
 * The running session of a chat's own conversation, the one its settings
 * name, or none while it has no turn to run.
 */
export function chatSessionRef(context: WorkspaceContext, id: ChatId) {
  const sessionId = sessionOfChat(id);
  return sessionId === undefined
    ? undefined
    : findLiveSessionRef(context, { id, sessionId });
}

export const workspaceMachine = setup({
  actions: {
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

    // A tab opened from the window and one an agent sends a command to both
    // reach the browser's lifetime here, which records the guest once.
    registerBrowserTarget: (
      { context },
      { targetId }: { targetId: BrowserTargetId },
    ) => {
      context.windowBrowserRef.send({
        type: "registerTarget",
        value: { targetId },
      });
    },

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

    windowBrowserLogic,

    workspaceServerLogic,
  },

  types: {
    context: {} as WorkspaceContext,
    events: {} as WorkspaceEvent,
    input: {} as {
      aiGatewayApp: AIGatewayApp;
      aiUsageFile?: string;
      apps: WorkspaceAppsConfig;
      appVersion: string;
      browser: BrowserConfig;
      captureException: CaptureExceptionFunction;
      driveNames?: WorkspaceConfig["driveNames"];
      ensureOutputFolderIcon?: WorkspaceConfig["ensureOutputFolderIcon"];
      finderEntries?: WorkspaceConfig["finderEntries"];
      resolveAlias?: WorkspaceConfig["resolveAlias"];
      isRefusedFile?: WorkspaceConfig["isRefusedFile"];
      getAIProviderConfigs: GetProviderConfigs;
      getUser?: WorkspaceConfig["getUser"];
      indexFile?: string;
      machineDir: string;
      workspaceMachineDir: string;
      modelCache: ModelCache;
      nativeSandbox?: WorkspaceConfig["nativeSandbox"];
      nodeExecEnv: Record<string, string>;
      outputDir?: string;
      pnpmBinPath: string;
      refreshExpiredCredentials?: WorkspaceConfig["refreshExpiredCredentials"];
      registryDir: string;
      rootDir: string;
      runtimeDir: string;
      systemSkillsDir: string;
      trashItem: (path: AbsolutePath) => Promise<void>;
      uvBinPath: string;
      macHelperBinPath?: string;
      knownFolders?: WorkspaceConfig["knownFolders"];
      webSearch: WebSearchClient;
    },
    output: {},
  },
}).createMachine({
  context: ({ input, self, spawn }) => {
    const rootDir = WorkspaceDirSchema.parse(input.rootDir);
    const layout = workspaceLayout(rootDir);
    const workspaceConfig: WorkspaceConfig = {
      ...(input.aiUsageFile && {
        aiUsageFile: AbsolutePathSchema.parse(input.aiUsageFile),
      }),
      apps: input.apps,
      appsDir: AbsolutePathSchema.parse(layout.appsDir),
      appVersion: input.appVersion,
      browser: input.browser,
      captureException: input.captureException,
      getAIProviderConfigs: input.getAIProviderConfigs,
      ...(input.ensureOutputFolderIcon
        ? { ensureOutputFolderIcon: input.ensureOutputFolderIcon }
        : {}),
      ...(input.driveNames ? { driveNames: input.driveNames } : {}),
      ...(input.finderEntries ? { finderEntries: input.finderEntries } : {}),
      ...(input.resolveAlias ? { resolveAlias: input.resolveAlias } : {}),
      ...(input.isRefusedFile ? { isRefusedFile: input.isRefusedFile } : {}),
      ...(input.getUser ? { getUser: input.getUser } : {}),
      ...(input.knownFolders ? { knownFolders: input.knownFolders } : {}),
      ...(input.indexFile && {
        indexFile: AbsolutePathSchema.parse(input.indexFile),
      }),
      machineDir: AbsolutePathSchema.parse(input.machineDir),
      workspaceMachineDir: AbsolutePathSchema.parse(input.workspaceMachineDir),
      workFoldersDir: absolutePathJoin(
        AbsolutePathSchema.parse(input.workspaceMachineDir),
        WORKSPACE_MACHINE_ENTRIES.work,
      ),
      modelCache: input.modelCache,
      ...(input.nativeSandbox && {
        nativeSandbox: input.nativeSandbox,
      }),
      nodeExecEnv: input.nodeExecEnv,
      ...(input.outputDir && {
        outputDir: AbsolutePathSchema.parse(input.outputDir),
      }),
      pnpmBinPath: AbsolutePathSchema.parse(input.pnpmBinPath),
      ...(input.refreshExpiredCredentials
        ? { refreshExpiredCredentials: input.refreshExpiredCredentials }
        : {}),
      registryDir: AbsolutePathSchema.parse(input.registryDir),
      rootDir,
      runtimeDir: AbsolutePathSchema.parse(input.runtimeDir),
      systemSkillsDir: AbsolutePathSchema.parse(input.systemSkillsDir),
      chatsDir: AbsolutePathSchema.parse(layout.chatsDir),
      legacyTasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
      trashItem: input.trashItem,
      uvBinPath: AbsolutePathSchema.parse(input.uvBinPath),
      ...(input.macHelperBinPath === undefined
        ? {}
        : {
            macHelperBinPath: AbsolutePathSchema.parse(input.macHelperBinPath),
          }),
      webSearch: input.webSearch,
    };
    // Publish the single per-process config so code can read it via
    // getWorkspaceConfig() instead of threading it through every ChatId.
    setWorkspaceConfig(workspaceConfig);
    registerAIUsageTelemetry();
    return {
      config: workspaceConfig,
      sessionRefsByChatId: new Map(),
      windowBrowserRef: spawn("windowBrowserLogic", {
        input: {
          browser: workspaceConfig.browser,
          isDrivenByWorkingAgent,
        },
      }),
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
      actions: ({ context, event }) => {
        context.windowBrowserRef.send({
          type: "acquireVisible",
          value: event.value,
        });
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

        // The user's doing, which wakes nothing: a task's turn this ends
        // must not write into the chat being trashed or start its turn.
        enqueue.raise({
          type: "stopSessions",
          value: {
            id: event.value.id,
            notice: { by: "user", wakesChat: false },
          },
        });
      }),
    },
    registerBrowserTarget: {
      actions: {
        params: ({ event }) => event.value,
        type: "registerBrowserTarget",
      },
    },
    releaseBrowserPresence: {
      actions: ({ context, event }) => {
        context.windowBrowserRef.send({
          type: "releaseVisible",
          value: event.value,
        });
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
        const { notice, reason, sessionId } = event.value;
        for (const sessionActorRef of sessionActorRefs ?? []) {
          if (
            sessionId === undefined ||
            sessionActorRef.getSnapshot().context.sessionId === sessionId
          ) {
            sessionActorRef.send({
              ...(notice ? { notice } : {}),
              ...(reason ? { reason } : {}),
              type: "stop",
            });
          }
        }
      },
    },

    // Only the chat's own conversation asks the user anything, so the
    // answer goes to its session and no task's.
    updateInteractiveToolCall: [
      {
        actions: ({ context, event }) => {
          chatSessionRef(context, event.value.id)?.send({
            type: "updateInteractiveToolCall",
            value: event.value.update,
          });
        },
        guard: ({ context, event }) =>
          chatSessionRef(context, event.value.id) !== undefined,
      },
      {
        actions: log(({ event }) => {
          return `No running session of ${event.value.id} to answer`;
        }),
      },
    ],

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
        params: ({ event }) => event.value,
        type: "registerBrowserTarget",
      },
    },
  },
  states: {
    Running: {},
  },
});

export type WorkspaceActorRef = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
