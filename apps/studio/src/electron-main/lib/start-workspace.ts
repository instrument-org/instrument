import { openBookmarks } from "@/electron-main/bookmarks/serve-bookmarks";
import { openDrafts } from "@/electron-main/drafts/serve-drafts";
import { scheduleRefresh as scheduleChatGPTAccountRefresh } from "@/electron-main/lib/chatgpt-account";
import { refreshClaudeAccountStatus } from "@/electron-main/lib/claude-account";
import { scheduleGrokRefresh } from "@/electron-main/lib/grok-account";
import { setClaudeAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { getDefaultModelURI } from "@/electron-main/stores/workspace/preferences";

import { timeBootStep } from "./boot-timing";
import { createWorkspaceActor } from "./create-workspace-actor";
import { chooseLaunchDeviceId, describeLaunchDevice } from "./launch-device-id";
import {
  type RunningWorkspace,
  setRunningWorkspace,
} from "./running-workspace";

/**
 * Starts the workspace settled for this process (`openWorkspace`): the
 * device its records are written as, the workspace actor, the bookmarks and
 * drafts a window's preload reads, and the account refreshes that keep its
 * sign-ins current. What boot does before the first window, and a live
 * switch before the next one.
 */
export async function startWorkspace(): Promise<RunningWorkspace> {
  // Chosen before the workspace starts, which writes every chat record
  // under it.
  const deviceId = await timeBootStep("chooseDeviceId", chooseLaunchDeviceId);
  void describeLaunchDevice(deviceId);
  const running = await timeBootStep("createWorkspaceActor", () =>
    createWorkspaceActor(deviceId),
  );
  setRunningWorkspace(running);
  // Before any window, whose preload reads them as it loads.
  await timeBootStep("openBookmarks", () => openBookmarks(deviceId));
  openDrafts();

  // A signed-in ChatGPT account's access token lasts an hour.
  scheduleChatGPTAccountRefresh();
  scheduleGrokRefresh();

  // The Claude account is whatever the CLI says, in the workspace's own
  // account folder. A workspace with no model chosen yet runs on the
  // subscription it found.
  void refreshClaudeAccountStatus().then(async (found) => {
    if (found.kind === "signed-in" && !getDefaultModelURI()) {
      await setClaudeAccountDefaultModel();
    }
  });
  return running;
}
