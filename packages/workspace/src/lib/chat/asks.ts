import { ulid } from "ulid";

import { type ChatId } from "../../schemas/chat-id";
import { type Ask, type PermissionAsk } from "../../schemas/chat-state";
import { type StoreId } from "../../schemas/store-id";
import { getChatState, updateChatState } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { chatDir } from "../record-folders";
import { askTargetName } from "../permissions/ask-target";
import { TOOL_NAMES } from "../../tools/name";

/** What raised an ask: the chat and the session that asked. */
export interface Asker {
  chatId: ChatId;
  /** The call that asked, by its part's id. */
  partId?: StoreId.Part;
  sessionId: StoreId.Session;
}

/**
 * Records that the agent asked for a folder or an app the person has not
 * answered for, so the chat shows the card. One card per thing: asking again
 * while the card is up raises nothing new, and another session that asks
 * joins the card, to be woken with its answer too.
 */
export async function recordAsk(
  asker: Asker & { reason?: string },
  kind: PermissionAsk["kind"],
  target: string,
): Promise<void> {
  const joining = {
    ...(asker.partId && { partId: asker.partId }),
    ...(asker.reason && { reason: asker.reason }),
    sessionId: asker.sessionId,
  };
  await updateChatState(chatDir(asker.chatId), (state) => {
    const asks = state.waitingOn;
    const open = asks.find((ask) => ask.kind === kind && ask.target === target);
    if (!open) {
      return {
        waitingOn: [
          ...asks,
          {
            askedAt: getCurrentDate(),
            askers: [joining],
            id: ulid(),
            kind,
            status: "open" as const,
            target,
          },
        ],
      };
    }
    if (open.askers.some((on) => on.sessionId === asker.sessionId)) {
      return {};
    }
    return {
      waitingOn: asks.map((ask) =>
        ask === open ? { ...ask, askers: [...ask.askers, joining] } : ask,
      ),
    };
  });
}

/** The chat's open permission cards, oldest first: this computer's. */
export async function openPermissionAsks(
  chatId: ChatId,
): Promise<PermissionAsk[]> {
  return (await getChatState(chatDir(chatId))).waitingOn;
}

/** Asks oldest first. */
export function sortAsks<T extends Ask>(asks: T[]): T[] {
  return asks.toSorted((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
}

/**
 * What an open card waits on the user for: the question itself, or the
 * folder or app it asks about.
 */
export function cardLine(card: Ask): string {
  return card.kind === "question"
    ? card.question.trim() || "Waiting for you to answer"
    : `Waiting for your OK to use ${askTargetName(card.kind, card.target)}`;
}

/** Takes an answered permission card off the chat, and answers what it was. */
export function closeAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionAsk | undefined> {
  return closeWhere(chatId, (ask): ask is PermissionAsk => ask.id === askId);
}

/**
 * Marks an allowed folder macOS refused, keeping the yes, so its card offers
 * the system's own ways in and a retry wakes the askers with it.
 */
export async function refusedByMacos(
  chatId: ChatId,
  askId: string,
  allowed: "allowed" | "always",
): Promise<void> {
  await updateChatState(chatDir(chatId), (state) => ({
    waitingOn: state.waitingOn.map((ask) =>
      ask.id === askId
        ? { ...ask, allowed, status: "macos-refused" as const }
        : ask,
    ),
  }));
}

/** Takes the card that matches off the chat. */
async function closeWhere<Closed extends PermissionAsk>(
  chatId: ChatId,
  matches: (ask: PermissionAsk) => ask is Closed,
): Promise<Closed | undefined> {
  let closed: Closed | undefined;
  await updateChatState(chatDir(chatId), (state) => {
    const asks = state.waitingOn;
    closed = asks.find(matches);
    return closed ? { waitingOn: asks.filter((ask) => ask !== closed) } : {};
  });
  return closed;
}

/**
 * Takes a session the person stopped off the cards it asked on, or with no
 * session every session off every card of the chat's, answering none: the
 * Stop ends what the session waited on them for, and an answer would start
 * it again. A card another session still waits on stays up for that one,
 * and one nobody is left on goes. A later ask for the same thing, by any
 * session, raises a card of its own. A question is closed by the Stop's own
 * record (`openQuestionsIn`).
 */
export async function closeAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session | undefined,
): Promise<void> {
  const stays = (asker: Ask["askers"][number]) =>
    sessionId !== undefined && asker.sessionId !== sessionId;
  // Most stops find nothing to close, and are not worth a write.
  if (
    (await openPermissionAsks(chatId)).every((ask) => ask.askers.every(stays))
  ) {
    return;
  }
  await updateChatState(chatDir(chatId), (state) => ({
    waitingOn: state.waitingOn.flatMap((ask) => {
      const askers = ask.askers.filter(stays);
      return askers.length ? [{ ...ask, askers }] : [];
    }),
  }));
}

/**
 * What the agent reads when it runs into something the person must allow
 * first: `what` it was kept from, and the folder or app to ask for.
 */
export function askFirstNote(what: string, ask: string): string {
  return `${what} needs the person's yes. If the work needs it, ask for ${ask} with ${TOOL_NAMES.askPermission}.`;
}
