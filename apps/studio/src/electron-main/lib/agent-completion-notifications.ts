import { logger } from "@/electron-main/lib/electron-logger";
import {
  type NotificationStatus,
  notificationStatus,
} from "@/electron-main/lib/mac-native";
import {
  type AgentCompletionNotificationMode,
  getWorkspacePreferences,
} from "@/electron-main/stores/workspace/preferences";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import {
  FILES_FENCE,
  MESSAGE_FENCE,
  parseMessage,
  type StoreId,
  type ChatId,
  type WorkspaceActorRef,
  type WorkspaceConfig,
  chatReads,
  chatSettles,
  settleIsNews,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, type InferRouterOutputs } from "@orpc/server";
import { isAppInFront } from "@/electron-main/windows/app-in-front";
import { app, BrowserWindow, Notification } from "electron";
import { sleep } from "radashi";

import { createChatNotifications } from "./chat-notifications";

const SUBSCRIPTION_RETRY_DELAY_MS = 1000;
const MAX_BUFFERED_COMPLETION_EVENTS = 100;
const MAX_NOTIFICATION_BODY_LENGTH = 200;

// Keep notifications reachable until dismissed or clicked so their event
// handlers stay alive.
const liveNotifications = new Set<Notification>();

const chatNotifications = createChatNotifications();

type Chat = NonNullable<
  InferRouterOutputs<typeof workspaceRouter>["chats"]["byId"]
>;
type Messages = InferRouterOutputs<typeof workspaceRouter>["message"]["list"];

export function shouldShowAgentCompletionNotification({
  canRevealChat,
  isAppWindowFocused,
  isSupported,
  mode,
  systemStatus,
}: {
  canRevealChat: boolean;
  isAppWindowFocused: boolean;
  isSupported: boolean;
  mode: AgentCompletionNotificationMode;
  systemStatus: NotificationStatus["status"];
}) {
  if (mode === "never") {
    return false;
  }
  // Until the person allows notifications (in setup or Settings), the first
  // one would put macOS's own prompt up out of context, so none is shown.
  if (systemStatus === "not-asked") {
    return false;
  }
  if (!isSupported || !canRevealChat) {
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
  canRevealChat,
  revealChat,
  workspaceConfig,
  workspaceRef,
}: {
  /** Whether a click can bring the chat up: a window to bring forward, or one it opens. */
  canRevealChat: () => boolean;
  /**
   * What a click on a notification does. Supplied by the caller: which window
   * a chat is shown in is the app's business, and reaching the modules that
   * answer that from here would pull every window's machinery in behind them.
   */
  revealChat: (id: ChatId) => void;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}) {
  /**
   * Tells the person a chat came to rest with what its last turn said. A
   * reply while anything of the chat's still moved never gets here (the line
   * said before a hand-off, a task sent back), and nor does a task's own end:
   * the chat settling is when the reply is news, even with a card waiting on
   * the user beside it.
   */
  async function showNotification(settle: {
    by?: Parameters<typeof settleIsNews>[0]["by"];
    id: ChatId;
    sessionId: StoreId.Session;
  }) {
    const { id, sessionId } = settle;
    // Whether the app is in front is asked last, once the reads below are
    // done: on Windows the answer costs a process start.
    if (
      !settleIsNews(settle) ||
      !(await canShowAgentCompletionNotification({
        canRevealChat,
        inFront: false,
      }))
    ) {
      return;
    }

    const context = { workspaceConfig, workspaceRef };

    let body: string | undefined;
    try {
      const messages = await call(
        workspaceRouter.message.list,
        { id, sessionId },
        { context },
      );
      body = latestTurnText(messages);
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read agent response for notification", error);
    }
    // A chat's turn that said nothing (a task steered, a note read) is not
    // a reply, and the user was not waiting on it.
    if (body === undefined) {
      return;
    }
    const chat = await chatOf({ context, id });

    const inFront = await isAppInFront();
    if (
      !(await canShowAgentCompletionNotification({ canRevealChat, inFront }))
    ) {
      return;
    }

    presentNotification({
      body,
      chat: { id, overApp: inFront },
      onClick: () => {
        revealChat(id);
      },
      title: chat?.title ?? "Task complete",
    });
  }

  /** The chat as the inbox lists it, for the title its reply is filed under. */
  async function chatOf({
    context,
    id,
  }: {
    context: {
      workspaceConfig: WorkspaceConfig;
      workspaceRef: WorkspaceActorRef;
    };
    id: ChatId;
  }): Promise<Chat | undefined> {
    try {
      return await call(workspaceRouter.chats.byId, { id }, { context });
    } catch (error) {
      logger
        .scope("agentCompletionNotifications")
        .warn("Failed to read the chat for notification", error);
      return undefined;
    }
  }

  async function subscribe() {
    while (true) {
      try {
        for await (const event of chatSettles({
          maxBuffered: MAX_BUFFERED_COMPLETION_EVENTS,
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

  async function closeOnRead() {
    while (true) {
      try {
        for await (const { id } of chatReads()) {
          chatNotifications.chatRead(id, {
            inFront: BrowserWindow.getFocusedWindow() !== null,
          });
        }
      } catch (error) {
        logger
          .scope("agentCompletionNotifications")
          .error("Chat read subscription failed", error);
      }

      await sleep(SUBSCRIPTION_RETRY_DELAY_MS);
    }
  }

  void subscribe();
  void closeOnRead();
  app.on("browser-window-focus", chatNotifications.appCameForward);
}

/**
 * The last thing a turn said, from its text parts in order: the last that
 * still reads as something once its fences and Markdown go, so a preamble
 * before the work ("I'll compare the transcripts") gives way to the answer.
 */
export function finalReplyText(texts: string[]): string | undefined {
  const text = texts.map(notificationText).findLast((said) => said.length > 0);

  if (text === undefined) {
    return undefined;
  }

  return text.length > MAX_NOTIFICATION_BODY_LENGTH
    ? `${text.slice(0, MAX_NOTIFICATION_BODY_LENGTH).trimEnd()}…`
    : text;
}

/**
 * A reply as a notification reads it: a files fence is a list of paths for
 * the app to draw as cards, so it goes; a message fence reads as the message
 * under its headers; and the rest loses its Markdown, since a notification
 * renders none, and its line breaks.
 */
export function notificationText(reply: string): string {
  const words = reply
    .replaceAll(FILES_FENCE, "")
    .replaceAll(MESSAGE_FENCE, (...match: unknown[]) => {
      const groups = match.at(-1) as { body?: string }; // named groups of MESSAGE_FENCE
      return parseMessage(groups.body ?? "").body;
    });
  return stripMarkdown(words).replaceAll(/\s+/g, " ").trim();
}

async function canShowAgentCompletionNotification({
  canRevealChat,
  inFront,
}: {
  canRevealChat: () => boolean;
  inFront: boolean;
}) {
  // An instance an agent boots off screen (`studio-drive boot` without
  // `--visible`) is never in front, so it would notify on every reply, and its
  // first one puts macOS's prompt up for that run's own bundle identifier.
  if (
    !app.isPackaged &&
    process.env.STUDIO_DRIVE_PURPOSE &&
    process.env.STUDIO_DRIVE_VISIBLE !== "1"
  ) {
    return false;
  }
  return shouldShowAgentCompletionNotification({
    canRevealChat: canRevealChat(),
    isAppWindowFocused: inFront,
    isSupported: Notification.isSupported(),
    mode: getWorkspacePreferences().get("agentCompletionNotifications"),
    systemStatus: await notificationStatus()
      .then(({ status }) => status)
      .catch((): NotificationStatus["status"] => "unknown"),
  });
}

/**
 * What a chat's turn ended on: the last words among the assistant messages
 * since the last thing that woke it, since a turn is one message per step and
 * its last step may only act. Nothing when the turn only acted.
 */
function latestTurnText(messages: Messages): string | undefined {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  return finalReplyText(
    messages
      .slice(turnStart + 1)
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        ),
      ),
  );
}

function presentNotification({
  body,
  chat,
  onClick,
  title,
}: {
  body: string | undefined;
  /** The chat it is about, and whether the app was in front as it went up. */
  chat?: { id: ChatId; overApp: boolean };
  onClick?: () => void;
  title: string;
}) {
  const notification = new Notification({ body, title });
  liveNotifications.add(notification);
  const forget = chat
    ? chatNotifications.add(chat.id, {
        close: () => {
          notification.close();
        },
        overApp: chat.overApp,
      })
    : undefined;
  notification.once("click", () => {
    liveNotifications.delete(notification);
    forget?.();
    onClick?.();
  });
  notification.on("close", ({ reason }) => {
    // Windows moves one that timed out into its notification center, where
    // it can still be clicked and still be taken away.
    if (reason === "timedOut") {
      return;
    }
    liveNotifications.delete(notification);
    forget?.();
  });
  notification.show();
}
