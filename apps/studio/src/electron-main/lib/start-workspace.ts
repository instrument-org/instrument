import { openBookmarks } from "../bookmarks/serve-bookmarks";
import { call } from "@orpc/server";
import {
  chatModelURI,
  draftMessagesIn,
  StoreId,
  turnEnds,
  workspaceRouter,
} from "@instrument-org/workspace/electron";

import { startBrowserExtensions } from "../browser-view/guest-session";
import { askedDraftCarries } from "../drafts/asked-draft-carries";
import { startFinishingAnsweredDrafts } from "../drafts/finish-answered-drafts";
import { startSendingAskedDrafts } from "../drafts/send-asked-drafts";
import {
  applyDraftOpsInMain,
  openDrafts,
  watchDrafts,
} from "../drafts/serve-drafts";
import { getDefaultModelURI } from "../stores/workspace/preferences";
import { getAppWindow, listChatFromPhone } from "../windows/app-window";
import { revealChat } from "../windows/reveal-chat";
import { startAgentCompletionNotifications } from "./agent-completion-notifications";
import { timeBootStep, timeBootStepSync } from "./boot-timing";
import { createWorkspaceActor } from "./create-workspace-actor";
import { startDeviceStatus } from "./device-status";
import { getWorkspaceFolder } from "./get-workspace-folder";
import { chooseLaunchDeviceId, describeLaunchDevice } from "./launch-device-id";
import { quitsWithLastWindow } from "./quit";
import { adoptFinderViewOnce } from "./finder-view";
import { startRun } from "./workspace-run";

let starting: Promise<void> | undefined;

/**
 * Starts the workspace the process placed, once: the device it writes as,
 * its actor, the bookmarks and drafts kept in it, and the notifications its
 * chats send. At launch for a workspace that has a folder, and from setup's
 * folder step once it has placed one. A start that fails can be asked for
 * again.
 */
export function startWorkspace(): Promise<void> {
  starting ??= (async () => {
    // Chosen before the workspace starts, which writes every chat record
    // under it.
    const deviceId = await timeBootStep("chooseDeviceId", chooseLaunchDeviceId);
    void describeLaunchDevice(deviceId);
    const { actor: workspaceRef, workspaceConfig } = await timeBootStep(
      "createWorkspaceActor",
      () => createWorkspaceActor(deviceId),
    );
    // Not waited for: a window that loads before they are read starts with
    // none and is sent them once they are, and a change it makes meanwhile
    // waits for them. On a synced folder after a restart, reading them has
    // taken most of a minute.
    void timeBootStep("serveBookmarks", () => openBookmarks(deviceId));
    await timeBootStep("adoptFinderView", adoptFinderViewOnce);
    timeBootStepSync("openDrafts", () => {
      openDrafts(deviceId);
    });
    // Their session is in the workspace's machine folder, and a window's
    // extension buttons ask for them as soon as a tab's row is drawn.
    timeBootStepSync("startBrowserExtensions", startBrowserExtensions);
    // A draft a phone asked this computer to send, which it sends on the
    // chat's own model, or a new chat's on the default, as a window would.
    const context = { workspaceConfig, workspaceRef };
    // Says in the workspace whether this computer is awake to answer, for a
    // phone choosing which computer sends its draft.
    timeBootStepSync("startDeviceStatus", () =>
      startDeviceStatus({
        countBusy: async () =>
          (
            await call(
              workspaceRouter.chats.agentStatus.aliveAgentCount,
              undefined,
              { context },
            )
          ).count,
        deviceId,
      }),
    );
    timeBootStepSync("startSendingAskedDrafts", () =>
      startSendingAskedDrafts({
        apply: applyDraftOpsInMain,
        carries: (draft) =>
          askedDraftCarries(draft, {
            chatTitle: async (id) =>
              (await call(workspaceRouter.chats.byId, { id }, { context }))
                ?.title,
            folders: async () =>
              (
                await call(workspaceRouter.window.ensure, undefined, {
                  context,
                })
              ).folders,
            rootDir: getWorkspaceFolder(),
          }),
        deviceId,
        send: async ({ asks, chatId, draftId, projectId, viewing, words }) => {
          const modelURI = (await chatModelURI(chatId)) ?? getDefaultModelURI();
          if (!modelURI) {
            throw new Error("No model is chosen to send with");
          }
          await call(
            workspaceRouter.message.create,
            {
              ...(asks ? { asks } : {}),
              fromDraft: draftId,
              id: chatId,
              modelURI,
              prompt: words,
              ...(projectId ? { project: projectId } : {}),
              ...(viewing ? { viewing } : {}),
            },
            { context },
          );
        },
        showChat: listChatFromPhone,
        startChat: async (words) => {
          const { id } = await call(
            workspaceRouter.chats.ensure,
            { firstWords: words, sessionId: StoreId.newSessionId() },
            { context },
          );
          return id;
        },
        watch: watchDrafts,
      }),
    );
    // A draft is kept until the turn its message started ends, whichever
    // window or device sent it.
    timeBootStepSync("startFinishingAnsweredDrafts", () =>
      startFinishingAnsweredDrafts({
        apply: applyDraftOpsInMain,
        messagesIn: draftMessagesIn,
        turnEnds,
        watch: watchDrafts,
      }),
    );
    timeBootStepSync("startAgentCompletionNotifications", () =>
      startAgentCompletionNotifications({
        // With no window, a notification's click opens one where the app stays
        // running; elsewhere no window means the app is quitting.
        canRevealChat: () => !quitsWithLastWindow || getAppWindow() !== null,
        revealChat,
        workspaceConfig,
        workspaceRef,
      }),
    );
    timeBootStepSync("startRun", () =>
      startRun({ workspaceConfig, workspaceRef }),
    );
  })().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}
