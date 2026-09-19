import { logger } from "@/electron-main/lib/electron-logger";
import {
  type AgentCompletionNotificationMode,
  getPreferencesStore,
} from "@/electron-main/stores/preferences";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import {
  FILES_FENCE,
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

type Messages = InferRouterOutputs<typeof workspaceRouter>["message"]["list"];

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
  revealTask,
  workspaceConfig,
  workspaceRef,
}: {
  /**
   * What a click on a notification does. Supplied by the caller: which window
   * a task is shown in is the app's business, and reaching the modules that
   * answer that from here would pull every window's machinery in behind them.
   */
  revealTask: (task: {
    id: TaskId;
    /** A thread of the conversation, which the inbox lists by its session. */
    isThread: boolean;
    sessionId: StoreId.Session;
  }) => void;
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
    let isThread = false;
    try {
      const task = await call(workspaceRouter.task.byId, { id }, { context });
      // A task the conversation started reports into its thread, and the
      // thread's reply is the news; a notification for each would say the
      // same thing twice, the first time in words meant for the conversation.
      if (task.parentTaskId !== undefined) {
        return;
      }
      isThread = task.kind === "orchestrator";
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
      body = isThread
        ? latestTurnText(messages)
        : latestAssistantText(messages);
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read agent response for notification", error);
    }
    // A thread's turn that said nothing (a task steered, a note read) is not
    // a reply, and the user was not waiting on it.
    if (isThread && body === undefined) {
      return;
    }
    if (isThread) {
      taskTitle = (await threadTitle({ context, id, sessionId })) ?? taskTitle;
    }

    // Reading the task is asynchronous, so the window may have regained
    // focus while it was in flight.
    if (!canShowAgentCompletionNotification({ isRootSession })) {
      return;
    }

    presentNotification({
      body,
      onClick: () => {
        revealTask({ id, isThread, sessionId });
      },
      title: taskTitle,
    });
  }

  /** What the thread is called in the inbox, which is what its reply is filed under. */
  async function threadTitle({
    context,
    id,
    sessionId,
  }: {
    context: {
      workspaceConfig: WorkspaceConfig;
      workspaceRef: WorkspaceActorRef;
    };
    id: TaskId;
    sessionId: StoreId.Session;
  }): Promise<string | undefined> {
    try {
      const threads = await call(
        workspaceRouter.orchestrator.threads.list,
        { id },
        { context },
      );
      return threads.find((thread) => thread.id === sessionId)?.title;
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read the thread for notification", error);
      return undefined;
    }
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

function bodyOf(messages: Messages): string | undefined {
  const raw = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n")
    // A files fence is a list of paths for the app to draw as cards, not
    // words to read.
    .replaceAll(FILES_FENCE, "");
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

// Reduces the last assistant message to a short plain-text body. Notifications
// render a couple of lines, so collapse whitespace and truncate.
function latestAssistantText(messages: Messages): string | undefined {
  const latest = messages.findLast((message) => message.role === "assistant");
  return latest ? bodyOf([latest]) : undefined;
}

/**
 * What a thread's turn said: every assistant message since the last thing
 * that woke it, since a turn is one message per step and the words can sit
 * on a step before the last. Nothing when the turn only acted.
 */
function latestTurnText(messages: Messages): string | undefined {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  return bodyOf(messages.slice(turnStart + 1));
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
