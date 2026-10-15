import { ResultAsync } from "neverthrow";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { createWriteQueue } from "./create-write-queue";
import { isStorageFullError } from "./is-storage-full-error";
import { isArriving } from "./records/arriving";
import { type ChatRecords, writingChatRecords } from "./records/chat-records";
import { type ToldWhat } from "./records/record";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * What a write to a chat's store also appends to its records, while the two
 * are written side by side: the store keeps its signatures, and every write
 * that settles something becomes the record that says so.
 *
 * - A write still arriving is not a record: streaming text and reasoning, a
 *   call whose input is still being typed, and a preliminary output are left
 *   out, and the snapshot that settles them is appended instead.
 * - A session row is diffed against what the records hold, since one row
 *   stands for a header, a rollover, a stop and the person's marks.
 * - Appends to one chat queue behind each other, so they go in the order the
 *   store wrote them: a session is started before its messages are appended.
 * - Nothing is waiting on an append, so a failure is reported rather than
 *   handed back; the store write it follows has already landed.
 * - A process with no records in place (a script, a test that has not asked
 *   for them) writes none.
 */
export namespace StoreRecords {
  /** A message, with the parts of it that have settled. */
  export function message(chatId: ChatId, saved: SessionMessage.Type): void {
    append(chatId, (records) => records.appendMessage(chatId, saved));
  }

  /** A message and its parts, which every read of the records sees together. */
  export function messageWithParts(
    chatId: ChatId,
    saved: SessionMessage.WithParts,
  ): void {
    const parts = saved.parts.filter((held) => !isArriving(held));
    append(chatId, (records) =>
      records.appendMessageWithParts(chatId, { ...saved, parts }),
    );
  }

  /** A part, unless it is still arriving. */
  export function part(chatId: ChatId, saved: SessionMessagePart.Type): void {
    if (isArriving(saved)) {
      return;
    }
    // The turn keeps a part while it arrives; this snapshot settles it, so
    // the record stands for it from here and memory lets it go.
    writingChatRecords()
      ?.live(chatId, saved.metadata.sessionId)
      .forget(saved.metadata.id);
    append(chatId, (records) => records.appendPart(chatId, saved));
  }

  /** A message taken out of its session, with its parts. */
  export function retract(
    chatId: ChatId,
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
  ): void {
    append(chatId, (records) =>
      records.retract(chatId, sessionId, [messageId], "removed"),
    );
  }

  /**
   * A session row as the records say it: its header the first time the row is
   * written, then whatever the row moved -- where its context window was
   * reset, who stopped its turn, and the person's marks. What it was last
   * updated at is nothing of its own, since the newest record's date says it.
   */
  export function session(chatId: ChatId, saved: Session.Type): void {
    append(chatId, (records) => records.saveSession(chatId, saved));
  }

  /**
   * Lets a chat's records go once everything the store wrote has landed: for
   * a chat being trashed, where an append after the delete would make its
   * folder again.
   */
  export async function close(chatId: ChatId): Promise<void> {
    // An append queued while this waits is waited for as well.
    while (tails.has(chatId)) {
      await tails.get(chatId);
    }
    await writingChatRecords()?.close(chatId);
  }

  /**
   * Lands what the chat has queued so far, for a writer about to let go of
   * the only other copy: an append waits its turn, and nothing else waits on
   * one, so a part the store has taken is in the records a moment later
   * rather than at once. A chat's appends go in order, so the one queued last
   * standing is every earlier one standing; one queued after this is asked
   * for is nobody's to wait for here, which is what keeps a chat whose task
   * is still writing from holding up its own reply.
   */
  export async function landed(chatId: ChatId): Promise<void> {
    await tails.get(chatId);
  }

  /**
   * Lands every chat's records and takes no more: the app on its way out.
   * The appends queued first, since one still waiting its turn would be
   * refused by records already closed and lost with them.
   */
  export async function settle(): Promise<void> {
    while (tails.size > 0) {
      await Promise.allSettled(tails.values());
    }
    await writingChatRecords()?.dispose();
  }

  /** What one of a session's standing facts was last set to; `undefined` clears it. */
  export function told(
    chatId: ChatId,
    sessionId: StoreId.Session,
    what: ToldWhat,
    value: unknown,
  ): void {
    append(chatId, (records) =>
      records.told(chatId, sessionId, what, value ?? null),
    );
  }
}

/** One queue per chat, so its records are appended in the order they were written. */
const queued = createWriteQueue();

/** The newest append queued for each chat, for a caller waiting on them all. */
const tails = new Map<ChatId, Promise<unknown>>();

/** Whether a full disk has been reported, which every append after it would repeat. */
let diskFullReported = false;

function append(
  chatId: ChatId,
  written: (records: ChatRecords) => Promise<void>,
): void {
  const records = writingChatRecords();
  if (!records) {
    return;
  }
  const appended = ResultAsync.fromThrowable(
    () => written(records),
    (error: unknown) => error,
  );
  const landed = queued(chatId, async () => {
    await appended()
      .andTee(() => {
        // The disk took a write, so the next one it refuses is news again.
        diskFullReported = false;
      })
      .orTee(report);
  });
  tails.set(chatId, landed);
  void landed.finally(() => {
    if (tails.get(chatId) === landed) {
      tails.delete(chatId);
    }
  });
}

/**
 * Tells the workspace what an append failed on. A full disk is reported once
 * rather than once per write, the way a streaming turn reports it
 * (`logic/llm-request.ts`), since every write after it fails the same way.
 */
function report(error: unknown): void {
  if (isStorageFullError(error)) {
    if (diskFullReported) {
      return;
    }
    diskFullReported = true;
  }
  if (hasWorkspaceConfig()) {
    getWorkspaceConfig().captureException(error, { scopes: ["workspace"] });
  }
}
