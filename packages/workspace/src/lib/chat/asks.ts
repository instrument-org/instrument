import { APP_NAME } from "@instrument-org/shared";
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
  /** The session's command waits on what the card is about itself (`waits` on the card's asker). */
  waits?: true;
}

/**
 * Records that the agent asked for a folder or an app the person has not
 * answered for, so the chat shows the card. One card per thing: asking again
 * while the card is up raises nothing new, and another session that asks
 * joins the card, to be woken with its answer too. `macos` raises it, or
 * turns the card already up, into one about the system's own answer (macOS,
 * or Windows' ransomware protection, with the `programs` it blocked), for a
 * thing the person's rules already allow. A tab's card carries its `page`.
 * Answers the card's id.
 */
export async function recordAsk(
  asker: Asker & { reason?: string },
  kind: PermissionAsk["kind"],
  target: string,
  extra?:
    | {
        allowed: "allowed" | "always";
        programs?: string[];
        status: MacosAskStatus;
      }
    | { page: NonNullable<PermissionAsk["page"]> },
): Promise<string> {
  const macos = extra && "status" in extra ? extra : undefined;
  const page = extra && "page" in extra ? extra : undefined;
  const joining = {
    ...(asker.partId && { partId: asker.partId }),
    ...(asker.reason && { reason: asker.reason }),
    sessionId: asker.sessionId,
    ...(asker.waits && { waits: true as const }),
  };
  let id = ulid();
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
            id,
            kind,
            status: "open" as const,
            target,
            ...macos,
            ...page,
          },
        ],
      };
    }
    id = open.id;
    const on = open.askers.find((one) => one.sessionId === asker.sessionId);
    // A session already on the card whose command waited on it, asking now
    // with a call that ends its turn, is woken by the answer from now on.
    const stopsWaiting = on?.waits === true && asker.waits !== true;
    if (on !== undefined && !stopsWaiting && macos === undefined) {
      return {};
    }
    return {
      waitingOn: asks.map((ask) =>
        ask === open
          ? {
              ...ask,
              ...macos,
              askers:
                on === undefined
                  ? [...ask.askers, joining]
                  : stopsWaiting
                    ? ask.askers.map((one) => (one === on ? joining : one))
                    : ask.askers,
            }
          : ask,
      ),
    };
  });
  return id;
}

/** What a card about macOS's own answer says: asking, refused, or private. */
export type MacosAskStatus = Exclude<PermissionAsk["status"], "open">;

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
  if (card.kind === "question") {
    return card.question.trim() || "Waiting for you to answer";
  }
  if (card.kind === "tab") {
    return `Waiting for you to move your tab “${card.page?.title || "a page"}” here`;
  }
  const name = askTargetName(card.kind, card.target);
  switch (card.status) {
    case "macos-asking":
      return `Your Mac is asking about ${name}`;
    case "windows-blocked":
      return `Windows is blocking changes to ${name}`;
    default:
      return `Waiting for your OK to use ${name}`;
  }
}

/** Takes an answered permission card off the chat, and answers what it was. */
export function closeAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionAsk | undefined> {
  return closeWhere(chatId, (ask): ask is PermissionAsk => ask.id === askId);
}

/**
 * Marks an allowed folder or app as waiting on macOS, keeping the yes:
 * macOS asking the person, refusing it (the card offers the system's own
 * ways in, and a retry wakes the askers with the yes), or keeping it to its
 * own app.
 */
export async function setMacosStatus(
  chatId: ChatId,
  askId: string,
  status: MacosAskStatus,
  allowed: "allowed" | "always",
): Promise<void> {
  await updateChatState(chatDir(chatId), (state) => ({
    waitingOn: state.waitingOn.map((ask) =>
      ask.id === askId ? { ...ask, allowed, status } : ask,
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

/**
 * What the agent is told when macOS itself refused a path the person's
 * rules allow: the card `ask` raises is the person's way to let the app in,
 * which the system's settings would otherwise be the only one of.
 */
export function macosRefusalNote(shown: string): string {
  return `macOS itself refused ${shown}, not the person's settings. If the work needs it, ask for ${shown} with ${TOOL_NAMES.askPermission}: its card shows them how to let ${APP_NAME} in. Never suggest Full Disk Access.`;
}
