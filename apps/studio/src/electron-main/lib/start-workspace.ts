import { openBookmarks } from "../bookmarks/serve-bookmarks";
import { openDrafts } from "../drafts/serve-drafts";
import { getAppWindow } from "../windows/app-window";
import { revealChat } from "../windows/reveal-chat";
import { startAgentCompletionNotifications } from "./agent-completion-notifications";
import { timeBootStep } from "./boot-timing";
import { createWorkspaceActor } from "./create-workspace-actor";
import { chooseLaunchDeviceId, describeLaunchDevice } from "./launch-device-id";
import { quitsWithLastWindow } from "./quit";
import { setStartedWorkspace } from "./started-workspace";

let starting: Promise<void> | undefined;

/**
 * Starts the workspace the process resolved, once: the device it writes as,
 * its actor, the bookmarks and drafts kept in it, and the notifications its
 * chats send. At launch for a workspace that has a folder, and from setup's
 * folder step on a first launch, once it has placed one.
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
    startAgentCompletionNotifications({
      // With no window, a notification's click opens one where the app stays
      // running; elsewhere no window means the app is quitting.
      canRevealChat: () => !quitsWithLastWindow || getAppWindow() !== null,
      revealChat,
      workspaceConfig,
      workspaceRef,
    });
    setStartedWorkspace({ workspaceConfig, workspaceRef });
  })();
  return starting;
}
