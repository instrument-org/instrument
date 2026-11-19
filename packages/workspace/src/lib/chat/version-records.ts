import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type StoreId } from "../../schemas/store-id";
import { chatSessions } from "../chat-info";
import { ChatReads } from "../chat-reads";
import { type KeptVersion } from "../file-versions";
import { sessionOfChat } from "../record-folders";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { thisDevice } from "./asks";

type Entry = SessionMessageDataPart.FileVersionsDataPart["files"][number];

/** One version of a file a chat recorded, as every reader of them takes it. */
export type VersionRecord = Omit<Entry, "number"> & {
  at: Date;
  device: string;
  /** Where the file is now, through any rename of the folder it was in since. */
  file: string;
  /** A reply's version, the file before the chat first changed it, one the person put back, or what that replaced. */
  kind: "before-restore" | "original" | "reply" | "restored";
  /** For a reply's, the first words the person asked it with. */
  label: string;
  messageId: StoreId.Message;
  /** Which version of the file it is in the chat, from 1. */
  number: number;
  /** The part that recorded it, and where it is among the part's files. */
  recordedIn: { index: number; partId: StoreId.Part };
};

/**
 * Numbers each file's records, given oldest first. A record keeps the number
 * it was written with; one an earlier build wrote without takes the number
 * of the file's record before it when it has the same contents, and the
 * file's next number otherwise, as `keepVersion` numbers them, a restore
 * always the next. The records are never rewritten and the trim leaves
 * them, so the numbers worked out are the same on every read.
 */
function numberInOrder<
  T extends { file: string; hash: string; kind: string; number?: number },
>(records: readonly T[]): (T & { number: number })[] {
  const last = new Map<string, { hash: string; number: number }>();
  const most = new Map<string, number>();
  return records.map((record) => {
    const before = last.get(record.file);
    const number =
      record.number ??
      (record.kind !== "restored" && before?.hash === record.hash
        ? before.number
        : (most.get(record.file) ?? 0) + 1);
    most.set(record.file, Math.max(most.get(record.file) ?? 0, number));
    last.set(record.file, { hash: record.hash, number });
    return { ...record, number };
  });
}

/**
 * Every file version the chat recorded, in its own session and its tasks',
 * oldest first, each numbered among its file's, with the ask each reply
 * answered and where each file is now. A task's transcript carries its
 * parent's messages up to where it started, so a part is counted once.
 */
export async function versionRecords(chatId: ChatId): Promise<VersionRecord[]> {
  const sessions = await chatSessions(chatId);
  const own = sessionOfChat(chatId);
  const ids =
    sessions.length > 0
      ? sessions.map((session) => session.id)
      : own === undefined
        ? []
        : [own];
  const seen = new Set<string>();
  const records: Omit<VersionRecord, "file" | "number">[] = [];
  const numbers: (number | undefined)[] = [];
  for (const sessionId of ids) {
    const read = await ChatReads.transcript({ chatId, sessionId });
    if (read.isErr()) {
      continue;
    }
    let opener: SessionMessage.WithParts | undefined;
    for (const message of read.value) {
      if (message.role === "user") {
        opener = message;
      }
      for (const part of message.parts) {
        if (part.type !== "data-fileVersions" || seen.has(part.metadata.id)) {
          continue;
        }
        seen.add(part.metadata.id);
        for (const [index, { number, ...file }] of part.data.files.entries()) {
          records.push({
            ...file,
            at: part.metadata.createdAt,
            recordedIn: { index, partId: part.metadata.id },
            device: part.data.device,
            kind: part.data.kind ?? "reply",
            label: part.data.kind === undefined ? askOf(opener) : "",
            messageId: message.id,
          });
          numbers.push(number);
        }
      }
    }
  }
  const now = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: [...new Set(records.map((record) => record.hostPath))],
  });
  return numberInOrder(
    records
      .map((record, index) => ({
        ...record,
        file: now.get(record.hostPath) ?? record.hostPath,
        ...(numbers[index] !== undefined && { number: numbers[index] }),
      }))
      .toSorted((a, b) => a.at.getTime() - b.at.getTime()),
  );
}

/**
 * What `keepVersion` reads of the chat's records to keep a version of
 * `file` in the versions folder `folder`: the file's versions, each with its
 * copy only where that is on this computer, and the folders there that other
 * files' versions are in.
 */
export function keptOf(
  records: readonly VersionRecord[],
  file: string,
  folder: string,
): { kept: KeptVersion[]; taken: Set<string> } {
  const here = thisDevice();
  const kept = records
    .filter((record) => record.file === file)
    .map((record) => ({
      ...(record.device === here &&
        record.copy !== undefined && { copy: record.copy }),
      hash: record.hash,
      number: record.number,
      size: record.size,
    }));
  const taken = new Set(
    records.flatMap((record) =>
      record.file !== file &&
      record.device === here &&
      record.copy !== undefined &&
      path.dirname(path.dirname(record.copy)) === folder
        ? [path.basename(path.dirname(record.copy))]
        : [],
    ),
  );
  return { kept, taken };
}

/**
 * `keptOf` over the chat's records, read once on first use: what a turn
 * reads to keep originals, all from the records as the turn began.
 */
export function keptReader(chatId: ChatId) {
  let records: Promise<VersionRecord[]> | undefined;
  return async (file: string, folder: string) =>
    keptOf(await (records ??= versionRecords(chatId)), file, folder);
}

/**
 * The messages with a number on every version an earlier build recorded
 * without one, worked out from all of the chat's records as the chat's
 * versions list works them out, so a card says what the list says. Read
 * only when a message has such a version.
 */
export async function withVersionNumbers(
  chatId: ChatId,
  messages: SessionMessage.WithParts[],
): Promise<SessionMessage.WithParts[]> {
  const isUnnumbered = (part: SessionMessage.WithParts["parts"][number]) =>
    part.type === "data-fileVersions" &&
    part.data.files.some((file) => file.number === undefined);
  if (!messages.some((message) => message.parts.some(isUnnumbered))) {
    return messages;
  }
  const numbers = new Map(
    (await versionRecords(chatId)).map((record) => [
      `${record.recordedIn.partId}:${String(record.recordedIn.index)}`,
      record.number,
    ]),
  );
  return messages.map((message) =>
    message.parts.some(isUnnumbered)
      ? {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "data-fileVersions"
              ? {
                  ...part,
                  data: {
                    ...part.data,
                    files: part.data.files.map((file, index) => {
                      const number =
                        file.number ??
                        numbers.get(`${part.metadata.id}:${String(index)}`);
                      return number === undefined ? file : { ...file, number };
                    }),
                  },
                }
              : part,
          ),
        }
      : message,
  );
}

/** What the person asked a turn with, on one line; the list cuts it to fit. */
function askOf(opener: SessionMessage.WithParts | undefined): string {
  return (opener?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}
