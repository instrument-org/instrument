import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { chatSessions } from "../chat-info";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { contentsOf, keepVersion, trimVersions } from "../file-versions";
import { sessionOfChat } from "../record-folders";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { sessionToolFs } from "../tool-fs";
import { workDir } from "../work-dir";
import { shellPath } from "../workspace-fs-layout";
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
  /** Where the file is now, through any rename of the folder it was in since. */
  file: string;
  kind: FileVersion["kind"];
  label: string;
  messageId: StoreId.Message;
};

/**
 * The versions a chat kept of the file at `path`, or of the file `path` is a
 * copy of: every record of it in any of the chat's sessions, matched by
 * where the file is now, with runs of the same contents told once. A copy
 * the trim has since removed is left out, so its version cannot be opened.
 * Null when the chat kept none.
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
  const file = copied?.file ?? at;
  const ofFile = records.filter((record) => record.file === file);
  if (ofFile.length === 0) {
    return null;
  }
  const current = await contentsOf(file);
  const here = thisDevice();
  const versions: FileVersion[] = [];
  for (const record of ofFile) {
    const last = versions.at(-1);
    if (last?.hash === record.hash) {
      // The same contents told once, from whichever record has a copy here.
      if (last.copy === undefined && record.device === here) {
        last.away = false;
        if (record.copy !== undefined && existsSync(record.copy)) {
          last.copy = record.copy;
        }
      }
      continue;
    }
    versions.push({
      at: record.at,
      away: record.device !== here,
      ...(record.copy !== undefined &&
        record.device === here &&
        existsSync(record.copy) && { copy: record.copy }),
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
 * its own. Returns the copy of what was replaced, for Undo, and when the
 * file was written, for the views open on it to show it at once.
 */
export async function restoreFileVersion({
  chatId,
  copy,
  file,
}: {
  chatId: ChatId;
  copy: string;
  file: string;
}): Promise<{ modifiedAt: number; replaced?: string }> {
  const here = thisDevice();
  const ofFile = (await recordsOf(chatId)).filter(
    (record) => record.device === here && record.file === file,
  );
  const version = ofFile.find((record) => record.copy === copy);
  if (version === undefined) {
    throw new Error("That is not a version this chat kept of the file.");
  }
  if ((await contentsOf(copy))?.hash !== version.hash) {
    // A copy edited since it was kept is no longer the version it names.
    throw new Error("That version’s copy has changed since it was kept.");
  }
  if ((await fs.lstat(file).catch(() => undefined))?.isSymbolicLink()) {
    // A link swapped in since would aim the restore, and the copy of what it
    // replaces, at a file the version was never of.
    throw new Error("That file is now a link, so it can't be restored.");
  }
  const folder = path.join(workDir(chatId), VERSIONS_FOLDER);
  const agentFs = await sessionToolFs({ chatId });
  const before = await keepVersion({
    file,
    folder,
    kept: ofFile,
    label: "before restoring",
    read: () => agentFs.fs.readFileBuffer(shellPath(file)),
  });
  if (before?.copy === undefined && existsSync(file)) {
    // Too big to copy, or unreadable to the agent: nothing would bring back
    // what the restore replaces.
    throw new Error(
      "There’s no way to keep a copy of that file as it is now, so it wasn’t restored.",
    );
  }
  await fs.copyFile(copy, file, fs.constants.COPYFILE_FICLONE);
  const { mtimeMs: modifiedAt } = await fs.stat(file);
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
    !ofFile.some((record) => record.copy === before.copy);
  await saveOnLastReply(chatId, [
    ...(isNew
      ? [{ entry: entry(before), kind: "before-restore" as const }]
      : []),
    { entry: entry(version), kind: "restored" as const },
  ]);
  if (isNew) {
    // The copy just made is the newest, so the trim leaves it for Undo.
    await trimVersions(folder);
  }
  return before?.copy === undefined
    ? { modifiedAt }
    : { modifiedAt, replaced: before.copy };
}

/** A file undoing a reply puts back: the file, and the copy of it from before the reply. */
const UndoFileSchema = z.object({ copy: z.string(), file: z.string() });

export const UndoableReplySchema = z.object({
  /** The files Undo puts back, each as it was before the reply's turn. */
  back: z.array(UndoFileSchema),
  messageId: StoreId.MessageSchema,
  /** The names of the files the reply handed over that Undo leaves as they are. */
  stay: z.array(z.string()),
});

type UndoableReply = z.output<typeof UndoableReplySchema>;

/**
 * The chat's replies that Undo would change a file for, each with what it
 * puts back and what it leaves. A file goes back to the copy a tool kept
 * before first changing it in the reply's turn, or else to the newest
 * version recorded before the turn; it stays when there is neither on this
 * computer (a file the turn made, one changed by a program no copy was kept
 * for), when the copy was edited since it was kept, or when the file already
 * holds those contents. A reply with nothing to put back is left out, so
 * nothing offers to undo it.
 */
export async function undoableReplies({
  chatId,
}: {
  chatId: ChatId;
}): Promise<UndoableReply[]> {
  const here = thisDevice();
  const records = (await recordsOf(chatId)).filter(
    (record) => record.device === here,
  );
  const hashes = new Map<string, Promise<string | undefined>>();
  const hashOf = (file: string) => {
    const known = hashes.get(file);
    if (known !== undefined) {
      return known;
    }
    const read = contentsOf(file).then((contents) => contents?.hash);
    hashes.set(file, read);
    return read;
  };
  const replies = [
    ...new Set(
      records
        .filter((record) => record.kind === "reply")
        .map((record) => record.messageId),
    ),
  ];
  const undoable: UndoableReply[] = [];
  for (const messageId of replies) {
    const ofReply = records.filter((record) => record.messageId === messageId);
    const startedAt = Math.min(...ofReply.map((record) => record.at.getTime()));
    const handed = [
      ...new Set(
        ofReply
          .filter((record) => record.kind === "reply")
          .map((record) => record.file),
      ),
    ];
    const back: UndoableReply["back"] = [];
    const stay: string[] = [];
    for (const file of handed) {
      const before =
        ofReply.find(
          (record) => record.kind === "original" && record.file === file,
        ) ??
        records.findLast(
          (record) => record.file === file && record.at.getTime() < startedAt,
        );
      if (
        before?.copy !== undefined &&
        (await hashOf(before.copy)) === before.hash &&
        (await hashOf(file)) !== before.hash
      ) {
        back.push({ copy: before.copy, file });
      } else {
        stay.push(path.basename(file));
      }
    }
    if (back.length > 0) {
      undoable.push({ back, messageId, stay });
    }
  }
  return undoable;
}

/**
 * Puts back the files {@link undoableReplies} names for a reply, each the
 * way a restore does, so each can be undone from its versions list. Returns
 * the names of the files it put back.
 */
export async function undoReplyFiles({
  chatId,
  messageId,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
}): Promise<{ restored: string[] }> {
  const reply = (await undoableReplies({ chatId })).find(
    (each) => each.messageId === messageId,
  );
  const restored: string[] = [];
  for (const { copy, file } of reply?.back ?? []) {
    await restoreFileVersion({ chatId, copy, file });
    restored.push(path.basename(file));
  }
  return { restored };
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

/**
 * Every file version the chat recorded, in its own session and its tasks',
 * oldest first, with the ask each reply answered and where each file is now.
 * A task's transcript carries its parent's messages up to where it started,
 * so a part is counted once.
 */
async function recordsOf(chatId: ChatId): Promise<Recorded[]> {
  const sessions = await chatSessions(chatId);
  const own = sessionOfChat(chatId);
  const ids =
    sessions.length > 0
      ? sessions.map((session) => session.id)
      : own === undefined
        ? []
        : [own];
  const seen = new Set<string>();
  const records: Omit<Recorded, "file">[] = [];
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
  }
  const now = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: [...new Set(records.map((record) => record.hostPath))],
  });
  return records
    .map((record) => ({
      ...record,
      file: now.get(record.hostPath) ?? record.hostPath,
    }))
    .toSorted((a, b) => a.at.getTime() - b.at.getTime());
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
