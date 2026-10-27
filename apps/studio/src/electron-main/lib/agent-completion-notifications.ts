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
  sessionEnds,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, type InferRouterOutputs } from "@orpc/server";
import { isAppInFront } from "@/electron-main/windows/app-in-front";
import { Notification } from "electron";
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

/**
 * Whether a turn's end leaves the chat at rest, which is when a notification
 * is news. A task of the chat's runs in its store, and its turn ending is
 * news the chat's own reply carries. A reply while anything of the chat's
 * still moves is a step on the way (the line said before a hand-off, a task
 * sent back), even when a card waits on the user beside it. A chat that
 * could not be read is told of anyway.
 */
export function settlesChat(
  chat: Pick<Chat, "sessionId" | "working"> | undefined,
  sessionId: StoreId.Session,
): boolean {
  return chat === undefined || (!chat.working && chat.sessionId === sessionId);
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
  async function showNotification({
    id,
    sessionId,
  }: {
    id: ChatId;
    sessionId: StoreId.Session;
  }) {
    // Whether the app is in front is asked last, once the reads below are
    // done: on Windows the answer costs a process start.
    if (
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
    if (!settlesChat(chat, sessionId)) {
      return;
    }

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

  /**
   * The chat as the inbox lists it: what its reply is filed under, and
   * whether it is still at work, read once its own turn has ended so only its
   * tasks count.
   */
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
        for await (const event of sessionEnds({
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
