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
 * answered for, so the chat shows the card. One ask per thing: running into
 * it again while the card is up raises nothing new.
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
  await updateChatState(chatDir(asker.chatId), (state) => {
    const asks = state.permissionAsks ?? [];
    if (asks.some((ask) => ask.kind === kind && ask.target === target)) {
      return {};
    }
    return {
      permissionAsks: [
        ...asks,
        {
          askedAt: getCurrentDate(),
          id: ulid(),
          kind,
          ...(asker.partId && { partId: asker.partId }),
          sessionId: asker.sessionId,
          target,
        },
      ],
    };
  });
}

/** The chat's open asks, oldest first. */
export async function openAsks(chatId: ChatId): Promise<PermissionAsk[]> {
  const record = await readChatRecord(chatDir(chatId));
  return record.state.permissionAsks ?? [];
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
 * Takes off the chat the asks a session the person stopped had raised, or
 * with no session every ask of the chat's, answering none: the Stop ends
 * what the session waited on them for, and an answer would start it again.
 * A later ask for the same thing, by any session, raises a card of its own.
 */
export async function closeAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session | undefined,
): Promise<void> {
  const raisedBy = (ask: PermissionAsk) =>
    sessionId === undefined || ask.sessionId === sessionId;
  // Most stops find nothing to close, and are not worth a write.
  if (!(await openAsks(chatId)).some(raisedBy)) {
    return;
  }
  await updateChatState(chatDir(chatId), (state) => ({
    permissionAsks: (state.permissionAsks ?? []).filter(
      (ask) => !raisedBy(ask),
    ),
  }));
}

/** What the agent reads when it runs into something the person must allow. */
export function waitingNote(what: string): string {
  return `Waiting on the person to allow ${what}. If the rest of the job needs it, end your turn here; you'll be woken with their answer.`;
}
