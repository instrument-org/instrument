import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { ChatReads } from "../chat-reads";
import { wakeChatForApp } from "../chat/wake";
import { resolveChat, sessionOfChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { appEventOf } from "./changed";
import { readConnection } from "./connection";
import { signInsSettled } from "../sign-in-progress-model-text";
import { signInCardOf, signInProgress } from "./sign-in-group";

type AppEventLine = SessionMessageDataPart.AppEventDataPart["events"][number];

/**
 * Wakes the chat that asked for an app when the user answers the ask
 * outside the conversation: a sign-in finished in the browser, a key saved
 * on a card, a decline, a failure. The host app publishes the event; here it
 * becomes a `data-appEvent` part on a text-less user message, the same way a
 * finishing task reaches the chat, so the agent learns without anyone typing
 * and answers on a turn of its own.
 *
 * The chats woken are every one the app's connection record says is waiting.
 * An answer that settles the ask (connected, declined) takes them all off the
 * record, since the standing every card draws is the app's and says the same
 * thing in each chat, and connecting the app again later from Settings wakes
 * nobody. A failure leaves them, since the user can try again from any of the
 * cards.
 *
 * An app asked for on one card with others wakes its chat once for the whole
 * card: an answer that leaves another app on it waiting wakes nothing, and
 * the answer that settles the last one wakes the chat with every app on the
 * card, read from their connections, and takes the chat off all of them. A
 * failure still wakes at once, with the card as it stands, since the agent
 * may have something to say about it. Once the chat has heard the card
 * settle, a sign-in to an app the user skipped on it (the card's row puts
 * the chat back on the app's waiting list, `waitInChat`) wakes it on its
 * own, with that one event.
 *
 * A disconnect or a removal is the user putting an app away, not answering
 * anything, so it wakes no chat; each chat hears of it on the next message
 * the user writes there.
 */
export function startAppEvents(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const event of publisher.subscribe("app.event")) {
      if (event.event === "disconnected" || event.event === "removed") {
        continue;
      }
      try {
        await answerWaitingChats(event, workspaceRef);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/** Wakes, or holds, every chat waiting on the app an event is about (`startAppEvents`). */
async function answerWaitingChats(
  event: AppEventLine,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const connection = await readConnection(event.slug);
  const waiting = connection?.waitingChats ?? [];
  await Promise.all(
    waiting.map((chatId) => answerChat(event, workspaceRef, chatId)),
  );
  if (event.event !== "failed") {
    await stopWaiting(event.slug, waiting);
  }
}

/**
 * Wakes one waiting chat with an event, or with its card once the event
 * settles the card, or holds the wake while the card has an app left.
 */
async function answerChat(
  event: AppEventLine,
  workspaceRef: WorkspaceActorRef,
  chatId: ChatId,
): Promise<void> {
  const card = await cardOf(chatId, event.slug);
  // A card of one app, or one the chat already heard settle: the user came
  // back to an app on it they had skipped, which is news of its own.
  if (card === undefined || card.apps.length < 2 || card.toldSettled) {
    await wakeChatForApp([event], workspaceRef, chatId);
    return;
  }
  const progress = await signInProgress(card.apps);
  if (progress === undefined) {
    await wakeChatForApp([event], workspaceRef, chatId);
    return;
  }
  if (event.event === "failed") {
    await wakeChatForApp([event], workspaceRef, chatId, progress);
    return;
  }
  if (!signInsSettled(progress)) {
    return;
  }
  const others = progress.filter((app) => app.slug !== event.slug);
  const events = [
    event,
    ...(await Promise.all(
      others.map((app) =>
        app.standing === "connected"
          ? connectedEvent(app.slug)
          : appEventOf(app.slug, { event: "declined" }),
      ),
    )),
  ];
  // Off every app on the card before the wake, so the answers to the others
  // that are still on their way ("Skip the rest" declines several at once)
  // find this chat waiting on nothing and wake it no second time.
  await Promise.all(others.map((app) => stopWaiting(app.slug, [chatId])));
  await wakeChatForApp(events, workspaceRef, chatId, progress);
}

/** The card in the chat's own conversation that `slug` has its row on. */
async function cardOf(chatId: ChatId, slug: string) {
  if (!resolveChat(chatId)) {
    return undefined;
  }
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return undefined;
  }
  const history = await ChatReads.history({ chatId, sessionId });
  return history.isOk() ? signInCardOf(history.value, slug) : undefined;
}

/** An app's connection told as the event that made it, as `announceConnected` tells it. */
async function connectedEvent(slug: string): Promise<AppEventLine> {
  const connection = await readConnection(slug);
  return appEventOf(slug, {
    ...(connection?.toolCount === undefined
      ? {}
      : { detail: `${connection.toolCount} tools` }),
    event: "connected",
  });
}

/** Takes chats off an app's waiting list, reading it again for a chat that asked meanwhile. */
async function stopWaiting(slug: string, answered: ChatId[]): Promise<void> {
  const after = await readConnection(slug);
  if (after?.waitingChats === undefined) {
    return;
  }
  const done = new Set(answered);
  const still = after.waitingChats.filter((chatId) => !done.has(chatId));
  if (still.length === after.waitingChats.length) {
    return;
  }
  const { waitingChats: _answered, ...rest } = after;
  await getWorkspaceConfig().apps.connections.set(slug, {
    ...rest,
    ...(still.length > 0 ? { waitingChats: still } : {}),
  });
}
