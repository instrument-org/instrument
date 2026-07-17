import { sendAppCommand } from "@/electron-main/app-command";
import { logger } from "@/electron-main/lib/electron-logger";
import { stripMarkdown } from "@/electron-main/lib/strip-markdown";
import {
  type AgentCompletionNotificationMode,
  getPreferencesStore,
} from "@/electron-main/stores/preferences";
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
import { call, type InferRouterOutputs } from "@orpc/server";
import { BrowserWindow, Notification } from "electron";
import { sleep } from "radashi";

const SUBSCRIPTION_RETRY_DELAY_MS = 1000;
const MAX_BUFFERED_COMPLETION_EVENTS = 100;
const MAX_NOTIFICATION_BODY_LENGTH = 200;

// Keep notifications reachable until dismissed or clicked so their event
// handlers stay alive.
const liveNotifications = new Set<Notification>();

export function shouldShowAgentCompletionNotification({
  isAppWindowFocused,
  isRootSession,
  isSupported,
  mainWindowAvailable,
  mode,
}: {
  isAppWindowFocused: boolean;
  isRootSession: boolean;
  isSupported: boolean;
  mainWindowAvailable: boolean;
  mode: AgentCompletionNotificationMode;
}) {
  if (mode === "never") {
    return false;
  }
  if (!isRootSession || !isSupported || !mainWindowAvailable) {
    return false;
  }
  return mode === "always" || !isAppWindowFocused;
}

// Shows a native notification on demand, bypassing focus/mode gating, so the
// user can verify delivery. Whether it actually appears depends on the OS
// notification permission, which Electron cannot query.
export function showAgentCompletionTestNotification() {
  if (!Notification.isSupported()) {
    return { supported: false };
  }
  presentNotification({
    body: "You'll see a notification like this when a task finishes.",
    title: "Notifications are on",
  });
  return { supported: true };
}

export function startAgentCompletionNotifications({
  workspaceConfig,
  workspaceRef,
}: {
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}) {
  async function showNotification({
    id,
    parentSessionId,
    sessionId,
  }: {
    id: TaskId;
    parentSessionId: StoreId.Session | undefined;
    sessionId: StoreId.Session;
  }) {
    const isRootSession = parentSessionId === undefined;
    if (!canShowAgentCompletionNotification({ isRootSession })) {
      return;
    }

    const context = { workspaceConfig, workspaceRef };

    let taskTitle = "Task complete";
    try {
      const task = await call(workspaceRouter.task.byId, { id }, { context });
      taskTitle = task.title;
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read completed task for notification", error);
    }

    let body: string | undefined;
    try {
      const messages = await call(
        workspaceRouter.message.list,
        { id, sessionId },
        { context },
      );
      body = latestAssistantText(messages);
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read agent response for notification", error);
    }

    // Reading the task is asynchronous, so the window may have regained
    // focus while it was in flight.
    if (!canShowAgentCompletionNotification({ isRootSession })) {
      return;
    }

    presentNotification({
      body,
      onClick: () => {
        focusTask(id);
      },
      title: taskTitle,
    });
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
    isAppWindowFocused: BrowserWindow.getFocusedWindow() !== null,
    isRootSession,
    isSupported: Notification.isSupported(),
    mainWindowAvailable: Boolean(mainWindow && !mainWindow.isDestroyed()),
    mode: getPreferencesStore().get("agentCompletionNotifications"),
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

// Reduces the last assistant turn to a short plain-text body. Notifications
// render a couple of lines, so collapse whitespace and truncate.
function latestAssistantText(
  messages: InferRouterOutputs<typeof workspaceRouter>["message"]["list"],
): string | undefined {
  const latest = messages.findLast((message) => message.role === "assistant");
  if (!latest) {
    return undefined;
  }

  const raw = latest.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  // Notifications render no formatting, so strip Markdown before collapsing
  // whitespace to avoid showing literal syntax like ** or [text](url).
  const text = stripMarkdown(raw).replaceAll(/\s+/g, " ").trim();

  if (text.length === 0) {
    return undefined;
  }

  return text.length > MAX_NOTIFICATION_BODY_LENGTH
    ? `${text.slice(0, MAX_NOTIFICATION_BODY_LENGTH).trimEnd()}…`
    : text;
}

function presentNotification({
  body,
  onClick,
  title,
}: {
  body: string | undefined;
  onClick?: () => void;
  title: string;
}) {
  const notification = new Notification({ body, title });
  liveNotifications.add(notification);
  notification.once("click", () => {
    liveNotifications.delete(notification);
    onClick?.();
  });
  notification.once("close", () => {
    liveNotifications.delete(notification);
  });
  notification.show();
}
