import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { contentsOf, keepVersion } from "../file-versions";
import { sessionOfChat } from "../record-folders";
import { workDir } from "../work-dir";
import { thisDevice } from "./asks";
import { VERSIONS_FOLDER } from "./turn-file-versions";

const FileVersionSchema = z.object({
  /** When it was kept. */
  at: z.date(),
  /** Whether another computer kept it, so its copy is there. */
  away: z.boolean(),
  /** Where its copy is on this computer; absent when it is on another, or none was made. */
  copy: z.string().optional(),
  hash: z.string(),
  /** A reply's version, the file before the chat first changed it, one the person put back, or what that replaced. */
  kind: z.enum(["before-restore", "original", "reply", "restored"]),
  /** For a reply's, the first words the person asked it with. */
  label: z.string(),
  /** Whether the file holds these contents now: the newest such version only. */
  now: z.boolean(),
});

type FileVersion = z.output<typeof FileVersionSchema>;

export const FileVersionHistorySchema = z.object({
  /** The file the versions are of, where it is now. */
  file: z.string(),
  /** Newest first, one per change of contents. */
  versions: z.array(FileVersionSchema),
  /** The version `path` is a copy of, when it is one. */
  viewing: FileVersionSchema.optional(),
});

type Recorded = SessionMessageDataPart.FileVersionsDataPart["files"][number] & {
  at: Date;
  device: string;
  kind: FileVersion["kind"];
  label: string;
  messageId: StoreId.Message;
};

/**
 * The versions a chat kept of the file at `path`, or of the file `path` is a
 * copy of: every record of it, matched by name since the chat's folder can
 * be renamed between turns, with runs of the same contents told once. Null
 * when the chat kept none.
 */
export async function fileVersionHistory({
  chatId,
  path: at,
}: {
  chatId: ChatId;
  path: string;
}): Promise<null | z.output<typeof FileVersionHistorySchema>> {
  const records = await recordsOf(chatId);
  const copied = records.find((record) => record.copy === at);
  const name = path.basename(copied?.hostPath ?? at);
  const ofFile = records.filter(
    (record) => path.basename(record.hostPath) === name,
  );
  const newest = ofFile.at(-1);
  if (newest === undefined) {
    return null;
  }
  const file = copied ? newest.hostPath : at;
  const current = await contentsOf(file);
  const here = thisDevice();
  const versions: FileVersion[] = [];
  for (const record of ofFile) {
    if (versions.at(-1)?.hash === record.hash) {
      continue;
    }
    versions.push({
      at: record.at,
      away: record.device !== here,
      ...(record.copy !== undefined &&
        record.device === here && { copy: record.copy }),
      hash: record.hash,
      kind: record.kind,
      label: record.label,
      now: false,
    });
  }
  versions.reverse();
  const isNow = versions.find((version) => version.hash === current?.hash);
  if (isNow) {
    isNow.now = true;
  }
  const viewing = copied
    ? versions.find((version) => version.hash === copied.hash)
    : undefined;
  return { file, versions, ...(viewing && { viewing }) };
}

/**
 * Puts the version kept at `copy` back over the file at `file`. What that
 * replaces is kept first, so the restore can be undone, and both are written
 * onto the chat's last reply, so its card stops passing the file off as
 * its own. Returns the copy of what was replaced, for Undo.
 */
export async function restoreFileVersion({
  chatId,
  copy,
  file,
}: {
  chatId: ChatId;
  copy: string;
  file: string;
}): Promise<{ replaced?: string }> {
  const here = thisDevice();
  const ofFile = (await recordsOf(chatId)).filter(
    (record) =>
      record.device === here &&
      path.basename(record.hostPath) === path.basename(file),
  );
  const version = ofFile.find((record) => record.copy === copy);
  if (version === undefined) {
    throw new Error("That is not a version this chat kept of the file.");
  }
  const folder = path.join(workDir(chatId), VERSIONS_FOLDER);
  const before = await keepVersion({
    file,
    folder,
    kept: ofFile,
    label: "before restoring",
  });
  await fs.copyFile(copy, file, fs.constants.COPYFILE_FICLONE);
  const entry = (kept: { copy?: string; hash: string; size: number }) => ({
    ...(kept.copy !== undefined && {
      copy: AbsolutePathSchema.parse(kept.copy),
    }),
    hash: kept.hash,
    hostPath: AbsolutePathSchema.parse(file),
    path: path.basename(file),
    size: kept.size,
  });
  const isNew =
    before !== undefined &&
    !ofFile.some((record) => record.hash === before.hash);
  await saveOnLastReply(chatId, [
    ...(isNew
      ? [{ entry: entry(before), kind: "before-restore" as const }]
      : []),
    { entry: entry(version), kind: "restored" as const },
  ]);
  return before?.copy === undefined ? {} : { replaced: before.copy };
}

/**
 * Puts back every file a reply handed over as it was before that reply's
 * turn: the copy a tool kept before first changing it, or else the newest
 * version recorded before the turn. Each goes back the way a restore does,
 * so each can be undone from its versions list. A file the turn made, or
 * whose earlier version is on another computer, is left as it is.
 */
export async function undoReplyFiles({
  chatId,
  messageId,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
}): Promise<{ left: string[]; restored: string[] }> {
  const here = thisDevice();
  const records = (await recordsOf(chatId)).filter(
    (record) => record.device === here,
  );
  const ofReply = records.filter((record) => record.messageId === messageId);
  const startedAt = Math.min(...ofReply.map((record) => record.at.getTime()));
  const left: string[] = [];
  const restored: string[] = [];
  for (const handed of ofReply.filter((record) => record.kind === "reply")) {
    const name = path.basename(handed.hostPath);
    const ofFile = records.filter(
      (record) => path.basename(record.hostPath) === name,
    );
    const before =
      ofReply.find(
        (record) =>
          record.kind === "original" && path.basename(record.hostPath) === name,
      ) ?? ofFile.findLast((record) => record.at.getTime() < startedAt);
    const file = ofFile.at(-1)?.hostPath ?? handed.hostPath;
    if (before?.copy === undefined) {
      left.push(name);
      continue;
    }
    if ((await contentsOf(file))?.hash !== before.hash) {
      await restoreFileVersion({ chatId, copy: before.copy, file });
    }
    restored.push(name);
  }
  return { left, restored };
}

async function saveOnLastReply(
  chatId: ChatId,
  parts: {
    entry: SessionMessageDataPart.FileVersionsDataPart["files"][number];
    kind: "before-restore" | "restored";
  }[],
): Promise<void> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return;
  }
  const read = await ChatReads.transcript({ chatId, sessionId });
  if (read.isErr()) {
    throw read.error;
  }
  const reply = read.value.findLast((message) => message.role === "assistant");
  if (reply === undefined) {
    return;
  }
  for (const { entry, kind } of parts) {
    const saved = await ChatWrites.savePart(
      {
        data: { device: thisDevice(), files: [entry], kind },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: reply.id,
          sessionId,
        },
        type: "data-fileVersions",
      },
      chatId,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
  }
}

/** Every file version the chat recorded, oldest first, with the ask each reply answered. */
async function recordsOf(chatId: ChatId): Promise<Recorded[]> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return [];
  }
  const read = await ChatReads.transcript({ chatId, sessionId });
  if (read.isErr()) {
    return [];
  }
  const records: Recorded[] = [];
  let opener: SessionMessage.WithParts | undefined;
  for (const message of read.value) {
    if (message.role === "user") {
      opener = message;
    }
    for (const part of message.parts) {
      if (part.type !== "data-fileVersions") {
        continue;
      }
      for (const file of part.data.files) {
        records.push({
          ...file,
          at: part.metadata.createdAt,
          device: part.data.device,
          kind: part.data.kind ?? "reply",
          messageId: message.id,
          label: part.data.kind === undefined ? askOf(opener) : "",
        });
      }
    }
  }
  return records.toSorted((a, b) => a.at.getTime() - b.at.getTime());
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
