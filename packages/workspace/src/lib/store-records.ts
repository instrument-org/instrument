import { ResultAsync } from "neverthrow";
import { isEqual } from "radashi";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { createWriteQueue } from "./create-write-queue";
import { isStorageFullError } from "./is-storage-full-error";
import { isToolPart } from "./is-tool-part";
import {
  type ChatRecords,
  type MarkChange,
  type SessionStart,
  writingChatRecords,
} from "./records/chat-records";
import { type FoldedSession } from "./records/fold";
import { type ToldWhat } from "./records/record";
import { sessionOf } from "./records/session-of";
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
    append(chatId, async (records) => {
      const known = await foldedSession(records, chatId, saved.id);
      if (!known) {
        await records.startSession(chatId, startOf(saved));
      }
      if (
        saved.rolledOverAfterMessageId !== undefined &&
        (known?.rollover?.after !== saved.rolledOverAfterMessageId ||
          known.rollover.usableTokens !== saved.rolledOverUnderUsableTokens)
      ) {
        await records.rollover(
          chatId,
          saved.id,
          saved.rolledOverAfterMessageId,
          saved.rolledOverUnderUsableTokens,
        );
      }
      // Against the stop itself rather than the session as it reads, which
      // leaves a stop behind once a turn starts after it: a row written then
      // still carries the stop it was last saved with, and saying so again
      // would stop the session a second time.
      if (
        saved.stoppedBy !== undefined &&
        known?.stopped?.by !== saved.stoppedBy
      ) {
        await records.stopped(chatId, saved.id, saved.stoppedBy);
      }
      // A session just started has the title its header carries and no marks.
      const was = known ? sessionOf(known) : { title: saved.title };
      for (const change of marksBetween(was, saved)) {
        await records.mark(chatId, saved.id, change);
      }
    });
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

/** The marks a session row carries, each in the shape its mark holds. */
type Marked = Pick<
  Session.Type,
  | "archivedAt"
  | "starredAt"
  | "stoppedAt"
  | "title"
  | "titleSettledAt"
  | "topics"
  | "unreadAt"
  | "unreadByUser"
>;

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

/**
 * Whether a part is still arriving, which is never written: text or
 * reasoning being streamed, a call whose input is still being typed, and the
 * preliminary output a tool gave before its own.
 */
function isArriving(part: SessionMessagePart.Type): boolean {
  if (isToolPart(part)) {
    return part.state === "input-streaming" || part.preliminary === true;
  }
  return (
    (part.type === "text" || part.type === "reasoning") &&
    part.state === "streaming"
  );
}

async function foldedSession(
  records: ChatRecords,
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<FoldedSession | undefined> {
  const read = await records.read(chatId);
  return read.chat.sessions.find(({ id }) => id === sessionId);
}

/** What a session's log header says, from the row it was first written as. */
function startOf(session: Session.Type): SessionStart {
  return {
    createdAt: session.createdAt,
    ...(session.forkedAtMessageId !== undefined && {
      forkedAt: session.forkedAtMessageId,
    }),
    ...(session.handle !== undefined && { handle: session.handle }),
    id: session.id,
    ...(session.parentId !== undefined && { parent: session.parentId }),
    title: session.title,
  };
}

/**
 * The marks the row moved: each one as its record holds it, left out where
 * the records already say the same thing. A mark whose value has not changed
 * is never rewritten, so it keeps the moment it was made, which is the date
 * the row keeps beside it.
 */
function marksBetween(was: Marked, now: Session.Type): MarkChange[] {
  const changes: MarkChange[] = [];
  if (
    was.title !== now.title ||
    (was.titleSettledAt === undefined) !== (now.titleSettledAt === undefined)
  ) {
    changes.push({
      field: "title",
      value: { settled: now.titleSettledAt !== undefined, text: now.title },
    });
  }
  if ((was.archivedAt === undefined) !== (now.archivedAt === undefined)) {
    changes.push({ field: "archived", value: now.archivedAt !== undefined });
  }
  if ((was.starredAt === undefined) !== (now.starredAt === undefined)) {
    changes.push({ field: "starred", value: now.starredAt !== undefined });
  }
  if (
    (was.unreadAt === undefined) !== (now.unreadAt === undefined) ||
    (was.unreadByUser === true) !== (now.unreadByUser === true)
  ) {
    changes.push({
      field: "unread",
      value:
        now.unreadAt === undefined
          ? null
          : { byUser: now.unreadByUser === true },
    });
  }
  if (now.topics !== undefined && !isEqual(was.topics ?? [], now.topics)) {
    changes.push({ field: "topics", value: now.topics });
  }
  if (
    now.stoppedAt !== undefined &&
    was.stoppedAt?.getTime() !== now.stoppedAt.getTime()
  ) {
    changes.push({ field: "stoppedAt", value: now.stoppedAt });
  }
  return changes;
}
