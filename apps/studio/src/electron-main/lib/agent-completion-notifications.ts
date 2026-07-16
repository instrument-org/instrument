import { sendAppCommand } from "@/electron-main/app-command";
import { logger } from "@/electron-main/lib/electron-logger";
import { getPreferencesStore } from "@/electron-main/stores/preferences";
import { focusMainContents } from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import {
  type StoreId,
  type TaskId,
  type WorkspaceActorRef,
  type WorkspaceConfig,
  workspacePublisher,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { BrowserWindow, Notification } from "electron";
import { sleep } from "radashi";

const SUBSCRIPTION_RETRY_DELAY_MS = 1000;
const MAX_BUFFERED_COMPLETION_EVENTS = 100;

export function shouldShowAgentCompletionNotification({
  enabled,
  isAppWindowFocused,
  isRootSession,
  isSupported,
  mainWindowAvailable,
}: {
  enabled: boolean;
  isAppWindowFocused: boolean;
  isRootSession: boolean;
  isSupported: boolean;
  mainWindowAvailable: boolean;
}) {
  return (
    enabled &&
    isRootSession &&
    isSupported &&
    mainWindowAvailable &&
    !isAppWindowFocused
  );
}

export function startAgentCompletionNotifications({
  workspaceConfig,
  workspaceRef,
}: {
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}) {
  // Keep notifications alive until they are dismissed or clicked so their
  // event handlers remain reachable.
  const notifications = new Set<Notification>();

  async function showNotification({
    id,
    parentSessionId,
  }: {
    id: TaskId;
    parentSessionId: StoreId.Session | undefined;
  }) {
    const isRootSession = parentSessionId === undefined;
    if (!canShowAgentCompletionNotification({ isRootSession })) {
      return;
    }

    let taskTitle = "Agent finished";
    try {
      const task = await call(
        workspaceRouter.task.byId,
        { id },
        { context: { workspaceConfig, workspaceRef } },
      );
      taskTitle = task.title;
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read completed task for notification", error);
    }

    // Reading the task is asynchronous, so the window may have regained
    // focus while it was in flight.
    if (!canShowAgentCompletionNotification({ isRootSession })) {
      return;
    }

    const notification = new Notification({
      body: taskTitle,
      title: "Agent finished",
    });
    notifications.add(notification);
    notification.once("click", () => {
      notifications.delete(notification);
      focusTask(id);
    });
    notification.once("close", () => {
      notifications.delete(notification);
    });
    notification.show();
  }

  async function subscribe() {
    while (true) {
      try {
        for await (const event of workspacePublisher.subscribe("session.done", {
          maxBufferedEvents: MAX_BUFFERED_COMPLETION_EVENTS,
        })) {
          await showNotification(event);
        }
      } catch (error) {
        logger
          .scope("agentCompletionNotifications")
          .error("Agent completion notification subscription failed", error);
      }

      await sleep(SUBSCRIPTION_RETRY_DELAY_MS);
    }
  }

  void subscribe();
}

function canShowAgentCompletionNotification({
  isRootSession,
}: {
  isRootSession: boolean;
}) {
  const mainWindow = getMainWindow();
  return shouldShowAgentCompletionNotification({
    enabled: getPreferencesStore().get("enableAgentCompletionNotifications"),
    isAppWindowFocused: BrowserWindow.getFocusedWindow() !== null,
    isRootSession,
    isSupported: Notification.isSupported(),
    mainWindowAvailable: Boolean(mainWindow && !mainWindow.isDestroyed()),
  });
}

function focusTask(id: string) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  focusMainContents();
  sendAppCommand({
    params: { id },
    to: "/tasks/$id/",
    type: "navigate",
  });
}
