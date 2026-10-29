import { logger } from "@/electron-main/lib/electron-logger";
import {
  type AgentCompletionNotificationMode,
  getWorkspacePreferences,
} from "@/electron-main/stores/workspace/preferences";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import {
  FILES_FENCE,
  type StoreId,
  type ChatId,
  type WorkspaceActorRef,
  type WorkspaceConfig,
  chatSettles,
  settleIsNews,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, type InferRouterOutputs } from "@orpc/server";
import { isAppInFront } from "@/electron-main/windows/app-in-front";
import { app, Notification } from "electron";
import { sleep } from "radashi";

const SUBSCRIPTION_RETRY_DELAY_MS = 1000;
const MAX_BUFFERED_COMPLETION_EVENTS = 100;
const MAX_NOTIFICATION_BODY_LENGTH = 200;

// Keep notifications reachable until dismissed or clicked so their event
// handlers stay alive.
const liveNotifications = new Set<Notification>();

type Chat = NonNullable<
  InferRouterOutputs<typeof workspaceRouter>["chats"]["byId"]
>;
type Messages = InferRouterOutputs<typeof workspaceRouter>["message"]["list"];

export function shouldShowAgentCompletionNotification({
  canRevealChat,
  isAppWindowFocused,
  isSupported,
  mode,
}: {
  canRevealChat: boolean;
  isAppWindowFocused: boolean;
  isSupported: boolean;
  mode: AgentCompletionNotificationMode;
}) {
  if (mode === "never") {
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
      !canShowAgentCompletionNotification({
        canRevealChat,
        inFront: false,
      })
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

    if (
      !canShowAgentCompletionNotification({
        canRevealChat,
        inFront: await isAppInFront(),
      })
    ) {
      return;
    }

    presentNotification({
      body,
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
  });
}

/**
 * What a chat's turn said: every assistant message since the last thing
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
