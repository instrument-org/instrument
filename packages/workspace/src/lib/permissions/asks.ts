import { folderNameFromPath } from "@instrument-org/shared";
import { AsyncResource } from "node:async_hooks";
import { ulid } from "ulid";

import { type ChatId } from "../../schemas/chat-id";
import { type PermissionAsk } from "../../schemas/chat-state";
import { StoreId } from "../../schemas/store-id";
import { readChatRecord, updateChatState } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { chatDir } from "../record-folders";

/** What raised an ask: the chat and the session that ran into the boundary. */
export interface Asker {
  chatId: ChatId;
  /** The tool call that raised it before running, by its part's id. */
  partId?: StoreId.Part;
  sessionId: StoreId.Session;
}

/**
 * Set in the bash worker, which cannot write the chat's record where the
 * app hears it: each ask goes to the main thread to be raised there.
 */
let forwardAsk:
  | ((ask: {
      asker: Asker;
      kind: PermissionAsk["kind"];
      target: string;
    }) => void)
  | undefined;

export function setAskForwarder(next: typeof forwardAsk): void {
  forwardAsk = next;
}

/**
 * Records that the agent ran into a folder or an app the person has not
 * answered for, so the chat shows the card. One card per thing: running into
 * it again while the card is up raises nothing new, and another session
 * that does joins the card, to be woken with its answer too.
 */
export function raiseAsk(
  asker: Asker,
  kind: PermissionAsk["kind"],
  target: string,
): void {
  if (forwardAsk) {
    forwardAsk({ asker, kind, target });
    return;
  }
  // Written from the async context this module loaded in rather than the
  // caller's: a shell builtin runs under just-bash's guard, which holds the
  // host's own file writes from inside a command.
  const written = outside
    .runInAsyncScope(() => recordAsk(asker, kind, target))
    .finally(() => {
      pending.delete(written);
    });
  pending.add(written);
}

/** Asks raised on this thread and not yet written. */
const pending = new Set<Promise<void>>();

const outside = new AsyncResource("PermissionAsk");

/**
 * Waits for every ask raised on this thread to be written, so a command
 * that raised one returns after its card is on the chat.
 */
export async function asksWritten(): Promise<void> {
  await Promise.allSettled(pending);
}

export async function recordAsk(
  asker: Asker,
  kind: PermissionAsk["kind"],
  target: string,
): Promise<void> {
  const joining = {
    ...(asker.partId && { partId: asker.partId }),
    sessionId: asker.sessionId,
  };
  await updateChatState(chatDir(asker.chatId), (state) => {
    const asks = state.permissionAsks ?? [];
    const open = asks.find((ask) => ask.kind === kind && ask.target === target);
    if (!open) {
      return {
        permissionAsks: [
          ...asks,
          {
            askedAt: getCurrentDate(),
            askers: [joining],
            id: ulid(),
            kind,
            target,
          },
        ],
      };
    }
    if (open.askers.some((on) => on.sessionId === asker.sessionId)) {
      return {};
    }
    return {
      permissionAsks: asks.map((ask) =>
        ask === open ? { ...ask, askers: [...ask.askers, joining] } : ask,
      ),
    };
  });
}

/** The chat's open asks, oldest first. */
export async function openAsks(chatId: ChatId): Promise<PermissionAsk[]> {
  const record = await readChatRecord(chatDir(chatId));
  return record.state.permissionAsks ?? [];
}

/** The chat's open asks a session is on, waiting to be woken with the answer, oldest first. */
export async function openAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<PermissionAsk[]> {
  return (await openAsks(chatId)).filter((ask) =>
    ask.askers.some((asker) => asker.sessionId === sessionId),
  );
}

/** What an open card waits on the user for, naming the folder or app it asks about. */
export function cardLine(card: PermissionAsk): string {
  const name =
    card.kind === "folder" ? folderNameFromPath(card.target) : card.target;
  return `Waiting for your OK to use “${name}”`;
}

/** Takes an answered ask off the chat, and answers what it was. */
export async function closeAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionAsk | undefined> {
  let closed: PermissionAsk | undefined;
  await updateChatState(chatDir(chatId), (state) => {
    const asks = state.permissionAsks ?? [];
    closed = asks.find((ask) => ask.id === askId);
    return { permissionAsks: asks.filter((ask) => ask.id !== askId) };
  });
  return closed;
}

/**
 * Takes a session the person stopped off the cards it asked on, or with no
 * session every session off every card of the chat's, answering none: the
 * Stop ends what the session waited on them for, and an answer would start
 * it again. A card another session still waits on stays up for that one,
 * and one nobody is left on goes. A later ask for the same thing, by any
 * session, raises a card of its own.
 */
export async function closeAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session | undefined,
): Promise<void> {
  const stays = (asker: PermissionAsk["askers"][number]) =>
    sessionId !== undefined && asker.sessionId !== sessionId;
  // Most stops find nothing to close, and are not worth a write.
  if ((await openAsks(chatId)).every((ask) => ask.askers.every(stays))) {
    return;
  }
  await updateChatState(chatDir(chatId), (state) => ({
    permissionAsks: (state.permissionAsks ?? []).flatMap((ask) => {
      const askers = ask.askers.filter(stays);
      return askers.length ? [{ ...ask, askers }] : [];
    }),
  }));
}

/** What the agent reads when it runs into something the person must allow. */
export function waitingNote(what: string): string {
  return `Waiting on the person to allow ${what}. If the rest of the job needs it, end your turn here; you'll be woken with their answer.`;
}
