import { openBookmarks } from "../bookmarks/serve-bookmarks";
import { call } from "@orpc/server";
import {
  chatModelURI,
  workspaceRouter,
} from "@instrument-org/workspace/electron";

import { startSendingAskedDrafts } from "../drafts/send-asked-drafts";
import {
  applyDraftOpsInMain,
  openDrafts,
  watchDrafts,
} from "../drafts/serve-drafts";
import { getDefaultModelURI } from "../stores/workspace/preferences";
import { getAppWindow } from "../windows/app-window";
import { revealChat } from "../windows/reveal-chat";
import { startAgentCompletionNotifications } from "./agent-completion-notifications";
import { timeBootStep } from "./boot-timing";
import { createWorkspaceActor } from "./create-workspace-actor";
import { chooseLaunchDeviceId, describeLaunchDevice } from "./launch-device-id";
import { quitsWithLastWindow } from "./quit";
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
    // Before any window that shows the app, whose preload reads them as it
    // loads.
    await timeBootStep("serveBookmarks", () => openBookmarks(deviceId));
    openDrafts();
    // A reply a phone asked this computer to send, which it sends on the
    // chat's own model as the chat's box would.
    startSendingAskedDrafts({
      apply: applyDraftOpsInMain,
      deviceId,
      send: async ({ chatId, draftId, words }) => {
        const modelURI = (await chatModelURI(chatId)) ?? getDefaultModelURI();
        if (!modelURI) {
          throw new Error("No model is chosen to send with");
        }
        await call(
          workspaceRouter.message.create,
          { fromDraft: draftId, id: chatId, modelURI, prompt: words },
          { context: { workspaceConfig, workspaceRef } },
        );
      },
      watch: watchDrafts,
    });
    startAgentCompletionNotifications({
      // With no window, a notification's click opens one where the app stays
      // running; elsewhere no window means the app is quitting.
      canRevealChat: () => !quitsWithLastWindow || getAppWindow() !== null,
      revealChat,
      workspaceConfig,
      workspaceRef,
    });
    startRun({ workspaceConfig, workspaceRef });
  })().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}
