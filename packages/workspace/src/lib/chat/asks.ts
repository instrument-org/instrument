import { APP_NAME } from "@instrument-org/shared";
import { ulid } from "ulid";

import { type ChatId } from "../../schemas/chat-id";
import { type Ask, type PermissionAsk } from "../../schemas/chat-state";
import {
  type CardAnswer,
  type CardDecision,
  type PermissionCard,
} from "../../schemas/permission-card";
import { type DeviceId } from "../../schemas/device-id";
import { type StoreId } from "../../schemas/store-id";
import { createWriteQueue } from "../create-write-queue";
import { getCurrentDate } from "../get-current-date";
import { sessionOfChat } from "../record-folders";
import { readDeviceName } from "../records/device-file";
import { writingChatRecords } from "../records/installed-records";
import { askTargetName } from "../permissions/ask-target";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { TOOL_NAMES } from "../../tools/name";

/**
 * A chat's permission cards: the folders, apps and tabs its agents asked the
 * person for. A card is a `card` record in the chat's own session's log,
 * written whole by the computer it belongs to, the one whose grants it is
 * about, so every device the chat syncs to shows it. Any device answers it
 * with an `answer` record in its own log; the first in log order wins, and
 * the card's computer takes it (`card-answers.ts`), grants what it says
 * there, and closes the card. A Stop on any device takes its sessions off
 * the card the same way.
 */

/** What raised an ask: the chat and the session that asked. */
export interface Asker {
  chatId: ChatId;
  /** The call that asked, by its part's id. */
  partId?: StoreId.Part;
  sessionId: StoreId.Session;
  /** The session's command waits on what the card is about itself (`waits` on the card's asker). */
  waits?: true;
}

/** A card still up, as `openCardsIn` reads it from the records. */
export interface OpenCard {
  /** The answer it has: the one its computer took, else the first given. */
  answer?: NonNullable<PermissionCard["answer"]> & { taken: boolean };
  /** The card, with only the sessions no Stop has taken off it. */
  card: PermissionCard;
}

/**
 * The cards still up among a session's records, oldest first: each card's
 * newest record, not closed, with the sessions that a Stop (an `answer`
 * that says `stopped`, from any device) made after they asked taken off it,
 * and with at least one session left. Its answer is the one its computer
 * took, or else the first decision in log order.
 */
export function openCardsIn({
  answers,
  cards,
}: {
  answers: readonly CardAnswer[];
  cards: readonly PermissionCard[];
}): OpenCard[] {
  const open: OpenCard[] = [];
  for (const card of cards) {
    if (card.closedAt !== undefined) {
      continue;
    }
    const toCard = answers.filter((answer) => answer.card === card.id);
    const askers = askersLeft(card, toCard);
    if (askers.length === 0) {
      continue;
    }
    const first = toCard.find(
      (answer): answer is CardAnswer & { decision: CardDecision } =>
        answer.decision !== "stopped" &&
        !(card.spent ?? []).some((ref) => isAnswer(answer, ref)),
    );
    const answer = card.answer
      ? { ...card.answer, taken: true }
      : first && {
          at: first.at,
          decision: first.decision,
          device: first.device,
          taken: false,
        };
    open.push({
      ...(answer && { answer }),
      card: askers.length === card.askers.length ? card : { ...card, askers },
    });
  }
  return open.toSorted(
    (a, b) => a.card.askedAt.getTime() - b.card.askedAt.getTime(),
  );
}

/**
 * The sessions still on a card: those no Stop made after they asked took
 * off it, by `answers` to it.
 */
function askersLeft(
  card: PermissionCard,
  answers: readonly CardAnswer[],
): PermissionCard["askers"] {
  return card.askers.filter(
    (asker) =>
      !answers.some(
        (answer) =>
          answer.card === card.id &&
          answer.decision === "stopped" &&
          answer.askers?.some(
            (entry) =>
              entry.sessionId === asker.sessionId &&
              entry.at.getTime() === asker.at.getTime(),
          ),
      ),
  );
}

/** Whether `answer` is the answer `ref` names: the same device, at the same moment by its clock. */
function isAnswer(
  answer: Pick<CardAnswer, "at" | "device">,
  ref: { at: Date; device: CardAnswer["device"] },
): boolean {
  return (
    answer.device === ref.device && answer.at.getTime() === ref.at.getTime()
  );
}

/**
 * The chat's cards and the answers to them, as its records have them with
 * this device's writes still on their way. Read through the records this
 * process has in place rather than `ChatReads`, which the permission rules
 * that raise a card cannot import without the records' own schemas
 * reaching back to them.
 */
async function cardRecords(
  chatId: ChatId,
): Promise<{ answers: CardAnswer[]; cards: PermissionCard[] }> {
  const sessionId = sessionOfChat(chatId);
  const records = writingChatRecords();
  if (sessionId === undefined || records === undefined) {
    return { answers: [], cards: [] };
  }
  // A chat whose records cannot be read has no card anyone can answer.
  const read = await records.read(chatId).catch(() => undefined);
  const session = read?.chat.sessions.find(({ id }) => id === sessionId);
  return { answers: session?.answers ?? [], cards: session?.cards ?? [] };
}

/** The records this process writes the chat's cards and answers to. */
function cardWriter(chatId: ChatId) {
  const records = writingChatRecords();
  if (records === undefined) {
    throw new Error(`No records are in place to write chat ${chatId} to`);
  }
  return records;
}

/** The chat's open cards, from every computer, oldest first (`openCardsIn`). */
export async function openCards(chatId: ChatId): Promise<OpenCard[]> {
  return openCardsIn(await cardRecords(chatId));
}

/** The open card by its id, or none. */
export async function openCard(
  chatId: ChatId,
  askId: string,
): Promise<OpenCard | undefined> {
  return (await openCards(chatId)).find(({ card }) => card.id === askId);
}

/**
 * This device's id, which a card it raises names as its computer: the one
 * its records are written as.
 */
export function thisDevice(): DeviceId {
  return writingChatRecords()?.device ?? getWorkspaceConfig().deviceId;
}

/**
 * Changes to this device's cards, one at a time per chat, so each reads what
 * the last one wrote.
 */
const cardWrites = createWriteQueue();

/**
 * Changes one of this device's open cards and writes it whole, answering the
 * card as it was before; nothing for a card that is not open, or another
 * computer's. `change` is handed the card with the sessions a Stop took off
 * it gone, and answers the card as it is to be, `closed` to close it, or
 * nothing to leave it. A card every session was taken off by a Stop on
 * another device is closed, whatever `change` says, and answers nothing.
 */
async function changeCard(
  chatId: ChatId,
  askId: string,
  change: (card: PermissionCard) => "closed" | PermissionCard | undefined,
): Promise<PermissionCard | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return undefined;
  }
  return cardWrites(chatId, async () => {
    const { answers, cards } = await cardRecords(chatId);
    const written = cards.find(
      (card) =>
        card.id === askId &&
        card.closedAt === undefined &&
        card.device === thisDevice(),
    );
    if (!written) {
      return undefined;
    }
    const askers = askersLeft(written, answers);
    if (askers.length === 0) {
      await write(chatId, sessionId, {
        ...written,
        closedAt: getCurrentDate(),
      });
      return undefined;
    }
    const card = { ...written, askers };
    const changed = change(card);
    if (changed !== undefined) {
      await write(
        chatId,
        sessionId,
        changed === "closed"
          ? { ...card, closedAt: getCurrentDate() }
          : changed,
      );
    } else if (askers.length < written.askers.length) {
      await write(chatId, sessionId, card);
    }
    return card;
  });
}

/**
 * Writes into each of this device's cards the Stops another device made
 * since, closing a card nobody is left on: what keeps a stopped session
 * from being woken by a later answer, and a card from waiting on no one.
 */
export async function takeStops(chatId: ChatId): Promise<void> {
  const { answers, cards } = await cardRecords(chatId);
  await Promise.all(
    cards
      .filter(
        (card) =>
          card.closedAt === undefined &&
          card.device === thisDevice() &&
          askersLeft(card, answers).length < card.askers.length,
      )
      .map((card) => changeCard(chatId, card.id, () => undefined)),
  );
}

async function write(
  chatId: ChatId,
  sessionId: StoreId.Session,
  card: PermissionCard,
): Promise<void> {
  await cardWriter(chatId).card(chatId, sessionId, card);
}

/**
 * Records that the agent asked for a folder or an app the person has not
 * answered for, so the chat shows the card on every computer it is open on.
 * One card per thing: asking again while the card is up raises nothing new,
 * and another session that asks joins the card, to be woken with its answer
 * too. `macos` raises it, or turns the card already up, into one about the
 * system's own answer (macOS, or Windows' ransomware protection, with the
 * `programs` it blocked), for a thing the person's rules already allow. A
 * tab's card carries its `page`. Answers the card's id.
 */
export async function recordAsk(
  asker: Asker & { reason?: string },
  kind: PermissionCard["kind"],
  target: string,
  extra?:
    | {
        allowed: "allowed" | "always";
        programs?: string[];
        status: MacosAskStatus;
      }
    | { page: NonNullable<PermissionCard["page"]> },
): Promise<string> {
  const macos = extra && "status" in extra ? extra : undefined;
  const page = extra && "page" in extra ? extra : undefined;
  const joining = {
    at: getCurrentDate(),
    ...(asker.partId && { partId: asker.partId }),
    ...(asker.reason && { reason: asker.reason }),
    sessionId: asker.sessionId,
    ...(asker.waits && { waits: true as const }),
  };
  const sessionId = sessionOfChat(asker.chatId);
  const id = ulid();
  if (sessionId === undefined) {
    return id;
  }
  return cardWrites(asker.chatId, async () => {
    const open = (await openCards(asker.chatId)).find(
      ({ card }) =>
        card.device === thisDevice() &&
        card.kind === kind &&
        card.target === target,
    )?.card;
    if (!open) {
      await write(asker.chatId, sessionId, {
        askedAt: joining.at,
        askers: [joining],
        device: thisDevice(),
        id,
        kind,
        status: "open",
        target,
        ...macos,
        ...page,
      });
      return id;
    }
    const on = open.askers.find((one) => one.sessionId === asker.sessionId);
    // A session already on the card whose command waited on it, asking now
    // with a call that ends its turn, is woken by the answer from now on.
    const stopsWaiting = on?.waits === true && asker.waits !== true;
    if (on !== undefined && !stopsWaiting && macos === undefined) {
      return open.id;
    }
    await write(asker.chatId, sessionId, {
      ...open,
      ...macos,
      askers:
        on === undefined
          ? [...open.askers, joining]
          : stopsWaiting
            ? open.askers.map((one) => (one === on ? joining : one))
            : open.askers,
    });
    return open.id;
  });
}

/** What a card about macOS's own answer says: asking, refused, or private. */
export type MacosAskStatus = Exclude<PermissionCard["status"], "open">;

/** Each computer's name by its device, once read. */
const computerNames = new Map<DeviceId, string>();

/**
 * The name a computer goes by, from its device file; "another computer" for
 * one whose file has not arrived yet.
 */
export async function computerName(device: DeviceId): Promise<string> {
  const known = computerNames.get(device);
  if (known !== undefined) {
    return known;
  }
  const name = await readDeviceName({
    device,
    devicesDir: workspaceLayout(getWorkspaceConfig().rootDir).devicesDir,
  });
  if (name === undefined) {
    return device === thisDevice() ? "this computer" : "another computer";
  }
  computerNames.set(device, name);
  return name;
}

/**
 * Whether a device other than the card's computer may answer it: while it
 * is open, unanswered, and not a tab, which is moved on the screen it is
 * on, as the system's own prompts and blocks are answered there.
 */
export function answerableElsewhere(
  card: Pick<PermissionCard, "kind" | "status">,
  answered: boolean,
): boolean {
  return !answered && card.kind !== "tab" && card.status === "open";
}

/** Open cards as this device's readers draw them, oldest first. */
export function asksOf(cards: readonly OpenCard[]): Promise<PermissionAsk[]> {
  return Promise.all(
    cards.map(async ({ answer, card }) => {
      const { closedAt: _closed, ...rest } = card;
      const here = card.device === thisDevice();
      return {
        ...rest,
        answerable: here || answerableElsewhere(card, answer !== undefined),
        ...(answer && {
          answered: {
            by: await computerName(answer.device),
            decision: answer.decision,
            taken: answer.taken,
          },
        }),
        computer: await computerName(card.device),
        here,
      };
    }),
  );
}

/** The chat's open permission cards, every computer's, oldest first. */
export async function openPermissionAsks(
  chatId: ChatId,
): Promise<PermissionAsk[]> {
  return asksOf(await openCards(chatId));
}

/** Asks oldest first. */
export function sortAsks<T extends { askedAt: Date }>(asks: T[]): T[] {
  return asks.toSorted((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
}

/**
 * What an open card waits on the user for: the question itself, or the
 * folder or app it asks about.
 */
export function cardLine(
  card: Ask | Pick<PermissionCard, "kind" | "page" | "status" | "target">,
): string {
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

/**
 * Closes one of this device's cards, answered and settled, and answers what
 * it was: its sessions are the ones to wake.
 */
export function closeAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionCard | undefined> {
  return changeCard(chatId, askId, () => "closed");
}

/**
 * Notes on one of this device's cards the answer it takes, from whichever
 * device gave it, so a card that stays up waiting on the system says it was
 * answered, and no later answer is taken. Answers the card as it was, or
 * none for one already answered.
 */
export function takeAnswer(
  chatId: ChatId,
  askId: string,
  answer: NonNullable<PermissionCard["answer"]>,
): Promise<PermissionCard | undefined> {
  let took = false;
  return changeCard(chatId, askId, (card) => {
    if (card.answer !== undefined) {
      return undefined;
    }
    took = true;
    const { failed: _failed, ...rest } = card;
    return { ...rest, answer };
  }).then((card) => (took ? card : undefined));
}

/**
 * Gives up on the answer one of this device's cards took, which could not
 * be carried out: the card is up and unanswered again, says why on
 * `failed`, and the answer is spent, so the next one given is taken rather
 * than this one again.
 */
export async function failAnswer(
  chatId: ChatId,
  askId: string,
  message: string,
): Promise<void> {
  await changeCard(chatId, askId, (card) => {
    if (card.answer === undefined) {
      return undefined;
    }
    const { answer, ...rest } = card;
    return {
      ...rest,
      failed: { ...answer, message },
      spent: [...(card.spent ?? []), { at: answer.at, device: answer.device }],
    };
  });
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
  await changeCard(chatId, askId, (card) =>
    card.status === status && card.allowed === allowed
      ? undefined
      : { ...card, allowed, status },
  );
}

/**
 * Appends this device's answer to a card, whichever computer it belongs
 * to. The first answer in log order wins; this one may come after another.
 */
export async function answerCard(
  chatId: ChatId,
  askId: string,
  decision: CardDecision,
): Promise<void> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return;
  }
  await cardWriter(chatId).answer(chatId, sessionId, { card: askId, decision });
}

/**
 * Takes a session the person stopped off the cards it asked on, or with no
 * session every session off every card of the chat's, answering none: the
 * Stop ends what the session waited on them for, and an answer would start
 * it again. A card another session still waits on stays up for that one,
 * and one nobody is left on closes. A later ask for the same thing, by any
 * session, raises a card of its own. This device's cards are written so; a
 * card of another computer's gets a `stopped` answer, which every device
 * reads the same way and that computer writes into the card. A question is
 * closed by the Stop's own record (`openQuestionsIn`).
 */
export async function closeAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session | undefined,
): Promise<void> {
  const stays = (asker: Pick<PermissionCard["askers"][number], "sessionId">) =>
    sessionId !== undefined && asker.sessionId !== sessionId;
  const leaving = (await openCards(chatId)).filter(({ card }) =>
    card.askers.some((asker) => !stays(asker)),
  );
  const chatSession = sessionOfChat(chatId);
  await Promise.all(
    leaving.map(async ({ card }) => {
      if (card.device === thisDevice()) {
        await changeCard(chatId, card.id, (now) => {
          const askers = now.askers.filter(stays);
          return askers.length === now.askers.length
            ? undefined
            : askers.length === 0
              ? "closed"
              : { ...now, askers };
        });
        return;
      }
      if (chatSession === undefined) {
        return;
      }
      // The entries it takes off, as this device saw the card, so no clock
      // but the card's own is read.
      await cardWriter(chatId).answer(chatId, chatSession, {
        askers: card.askers
          .filter((asker) => !stays(asker))
          .map(({ at, sessionId: asking }) => ({ at, sessionId: asking })),
        card: card.id,
        decision: "stopped",
      });
    }),
  );
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
