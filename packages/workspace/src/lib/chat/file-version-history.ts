import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import {
  contentsOf,
  keepVersion,
  type KeptVersion,
  trimVersions,
} from "../file-versions";
import { sessionOfChat } from "../record-folders";
import { sessionToolFs } from "../tool-fs";
import { workDir } from "../work-dir";
import { shellPath } from "../workspace-fs-layout";
import { thisDevice } from "./asks";
import { keptOf, versionRecords } from "./version-records";
import { VERSIONS_FOLDER, VERSIONS_FOLDERS } from "./versions-folder";

const FileVersionSchema = z.object({
  /** When it was kept. */
  at: z.date(),
  /** Whether another computer kept it, so its copy is there. */
  away: z.boolean(),
  /** Where its copy is on this computer; absent when it is on another, or none was made. */
  copy: z.string().optional(),
  /** For one the person put back, the number of the version it was. */
  from: z.number().optional(),
  hash: z.string(),
  /** A reply's version, the file before the chat first changed it, one the person put back, or what that replaced. */
  kind: z.enum(["before-restore", "original", "reply", "restored"]),
  /** For a reply's, the first words the person asked it with. */
  label: z.string(),
  /** Whether the file holds these contents now: the newest such version only. */
  now: z.boolean(),
  /** Which version of the file it is in the chat, from 1, the oldest. */
  number: z.number(),
  /** How many bytes it held when it was kept. */
  size: z.number(),
});

type FileVersion = z.output<typeof FileVersionSchema>;

export const FileVersionHistorySchema = z.object({
  /** The file the versions are of, where it is now. */
  file: z.string(),
  /** Newest first, one per number. */
  versions: z.array(FileVersionSchema),
  /** The version `path` is a copy of, when it is one. */
  viewing: FileVersionSchema.optional(),
});

/**
 * The versions a chat kept of the file at `path`, or of the file `path` is a
 * copy of: every record of it in any of the chat's sessions, matched by
 * where the file is now, each number told once. A copy the trim has since
 * removed is left out, so its version cannot be opened. Null when the chat
 * kept none.
 */
export async function fileVersionHistory({
  chatId,
  path: at,
}: {
  chatId: ChatId;
  path: string;
}): Promise<null | z.output<typeof FileVersionHistorySchema>> {
  const records = await versionRecords(chatId);
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
    const told = versions.find(
      (version) =>
        version.number === record.number && version.hash === record.hash,
    );
    if (told) {
      // The same version told once, from whichever record has a copy here.
      if (told.copy === undefined && record.device === here) {
        told.away = false;
        if (record.copy !== undefined && existsSync(record.copy)) {
          told.copy = record.copy;
        }
      }
      continue;
    }
    // What an earlier build put back names no number: the version it was
    // is the newest before it with the same contents.
    const from =
      record.from ??
      (record.kind === "restored"
        ? versions.findLast(
            (version) =>
              version.kind !== "restored" && version.hash === record.hash,
          )?.number
        : undefined);
    versions.push({
      at: record.at,
      away: record.device !== here,
      ...(record.copy !== undefined &&
        record.device === here &&
        existsSync(record.copy) && { copy: record.copy }),
      ...(from !== undefined && { from }),
      hash: record.hash,
      kind: record.kind,
      label: record.label,
      now: false,
      number: record.number,
      size: record.size,
    });
  }
  versions.reverse();
  const isNow = versions.find((version) => version.hash === current?.hash);
  if (isNow) {
    isNow.now = true;
  }
  const viewing = copied
    ? versions.find(
        (version) =>
          version.number === copied.number && version.hash === copied.hash,
      )
    : undefined;
  return { file, versions, ...(viewing && { viewing }) };
}

/** Why a restore didn't happen, in words written for the person who asked for it. */
export class RestoreRefusal extends Error {}

/**
 * Puts the version kept at `copy` back over the file at `file`, as the copy
 * is now, edited since or not. What that replaces is kept first, so the
 * restore can be undone, and what it put back is kept as a version of its
 * own, the next number; both are written onto the chat's last reply, so its
 * card stops passing the file off as its own. Returns the copy of what was
 * replaced, for Undo, and when the file was written, for the views open on
 * it to show it at once.
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
  const records = await versionRecords(chatId);
  const version = records.find(
    (record) =>
      record.device === here && record.file === file && record.copy === copy,
  );
  if (version === undefined) {
    throw new RestoreRefusal(
      "That is not a version this chat kept of the file.",
    );
  }
  if ((await fs.lstat(file).catch(() => undefined))?.isSymbolicLink()) {
    // A link swapped in since would aim the restore, and the copy of what it
    // replaces, at a file the version was never of.
    throw new RestoreRefusal(
      "That file is now a link, so it can't be restored.",
    );
  }
  await refuseUnwritable(file);
  const folder = path.join(workDir(chatId), VERSIONS_FOLDER);
  const { kept, taken } = keptOf(records, file, folder);
  const agentFs = await sessionToolFs({ chatId });
  const before = await keepVersion({
    file,
    folder,
    kept,
    read: () => agentFs.fs.readFileBuffer(shellPath(file)),
    taken,
  });
  if (before?.copy === undefined && existsSync(file)) {
    // Too big to copy, or unreadable to the agent: nothing would bring back
    // what the restore replaces.
    throw new RestoreRefusal(
      "There’s no way to keep a copy of that file as it is now, so it wasn’t restored.",
    );
  }
  const isNew =
    before !== undefined &&
    !records.some(
      (record) =>
        record.device === here &&
        record.file === file &&
        record.copy === before.copy,
    );
  try {
    await fs.copyFile(copy, file, fs.constants.COPYFILE_FICLONE);
  } catch (error) {
    // No record names the copy just kept, so it would be left as a stray.
    if (isNew && before.copy !== undefined) {
      await fs.rm(before.copy, { force: true });
    }
    throw refusalFor(error, file) ?? error;
  }
  const { mtimeMs: modifiedAt } = await fs.stat(file);
  const restored = await keepVersion({
    file,
    folder,
    fresh: true,
    kept: isNew ? [...kept, before] : kept,
    taken,
  });
  const entry = (each: KeptVersion) => ({
    ...(each.copy !== undefined && {
      copy: AbsolutePathSchema.parse(each.copy),
    }),
    hash: each.hash,
    hostPath: AbsolutePathSchema.parse(file),
    number: each.number,
    path: path.basename(file),
    size: each.size,
  });
  await saveOnLastReply(chatId, [
    ...(isNew
      ? [{ entry: entry(before), kind: "before-restore" as const }]
      : []),
    ...(restored
      ? [
          {
            entry: { ...entry(restored), from: version.number },
            kind: "restored" as const,
          },
        ]
      : []),
  ]);
  // The copies just made are the newest, so the trim leaves them for Undo.
  await trimVersions(
    VERSIONS_FOLDERS.map((name) => path.join(workDir(chatId), name)),
  );
  return before?.copy === undefined
    ? { modifiedAt }
    : { modifiedAt, replaced: before.copy };
}

/**
 * Refuses a file the restore couldn't write over, before anything is kept for
 * it: one another app has open (Windows locks a file Excel or Word has
 * open), or one that is read-only.
 */
async function refuseUnwritable(file: string): Promise<void> {
  const handle = await fs.open(file, "r+").catch((error: unknown) => {
    if (isCode(error, "ENOENT")) {
      return undefined;
    }
    throw refusalFor(error, file) ?? error;
  });
  await handle?.close();
}

/** What to tell the person for a write over `file` the disk refused, when it is one they can act on. */
function refusalFor(error: unknown, file: string): RestoreRefusal | undefined {
  if (isCode(error, "EBUSY")) {
    return new RestoreRefusal(
      "That file is open in another app, so it wasn’t restored. Close it there and try again.",
    );
  }
  if (isCode(error, "EPERM") || isCode(error, "EACCES")) {
    const isReadOnly = (() => {
      try {
        return (statSync(file).mode & 0o200) === 0;
      } catch {
        return false;
      }
    })();
    return new RestoreRefusal(
      isReadOnly
        ? "That file is read-only, so it wasn’t restored."
        : "That file can’t be changed right now, so it wasn’t restored.",
    );
  }
  return undefined;
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
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
  const records = (await versionRecords(chatId)).filter(
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
