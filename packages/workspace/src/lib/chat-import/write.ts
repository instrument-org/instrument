import { ResultAsync } from "neverthrow";
import { renameSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { monotonicFactory } from "ulid";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { cappedTitle } from "../chat-folders/folder-name";
import { newChatName } from "../chat-folder-name";
import { openingTitle } from "../chat/shown-title";
import { TypedError } from "../errors";
import { recordChanged } from "../record-changes";
import {
  chatIdTaken,
  chatsDir,
  isStagingFolderName,
  placeChat,
} from "../record-folders";
import { logFileName, settingsFileName } from "../records/file-names";
import {
  RECORD_FORMAT,
  type LogRecord,
  type SettingRecord,
} from "../records/record";
import {
  chatRecordFormat,
  RecordWriter,
  type Unsequenced,
} from "../records/record-writer";
import { syncDirectory } from "../records/sync-directory";
import { getWorkspaceConfig } from "../workspace-config";
import { rememberImported } from "./imported";
import {
  type ImportedFrom,
  type ImportedMessage,
  type ImportedTranscript,
  type ImportOmitted,
} from "./model";

/**
 * Writing a chat read from another AI app as a chat of this workspace.
 *
 * The records are this device's, as a chat it wrote itself would be, but
 * dated from the source: the header from when the chat began, each message
 * from when it was written, so the chat's last activity is when it really
 * happened and it sorts among the chats of that time. Its own session's
 * header names where it came from (`imported`), which is what a second import
 * of the same chat finds and skips. It is titled as settled, so the app never
 * renames it, and has no model, unread mark, topic or archive.
 *
 * A chat is never seen half written. Its files are written into a folder in
 * the chats folder that sync engines skip and the chat index passes over
 * (`.~import-<pid>-<n>.tmp`), synced, and the folder renamed to the chat's id
 * in one step, the chat placed in the index in the same tick. A run cut off
 * before the rename leaves only that folder, which the next run removes
 * (`clearStaleImports`).
 */

/** Distinguishes the staging folders of one process. */
let staged = 0;

const STAGING = /^\.~import-(\d+)-\d+\.tmp$/;

/** Writes one transcript as a new chat, and answers with its id. */
export function writeImportedChat(
  transcript: ImportedTranscript,
): ResultAsync<ChatId, TypedError.InvalidInput | TypedError.Storage> {
  return ResultAsync.fromPromise(write(transcript), (error) =>
    error instanceof TypedError.InvalidInput
      ? error
      : new TypedError.Storage(
          error instanceof Error ? error.message : String(error),
          { cause: error },
        ),
  );
}

async function write(transcript: ImportedTranscript): Promise<ChatId> {
  const { appVersion, deviceId } = getWorkspaceConfig();
  const root = chatsDir();
  const opening = transcript.messages.find(
    (message) => message.role === "user" && message.text.trim() !== "",
  );
  if (!opening) {
    throw new TypedError.InvalidInput(
      "It has no message from the person to start it.",
    );
  }
  const startedAs = openingTitle(opening.text) || undefined;
  const title = cappedTitle(transcript.title.trim()) || startedAs;
  const nextId = monotonicFactory();
  const sessionId = StoreId.SessionSchema.parse(
    `ses_${nextId(transcript.createdAt.getTime())}`,
  );
  const chatId = pickChatId(transcript.createdAt, title);

  const imported: ImportedFrom = {
    kind: transcript.kind,
    sourceId: transcript.sourceId,
  };
  const header: Unsequenced<LogRecord> = {
    app: appVersion,
    at: transcript.createdAt,
    chat: chatId,
    createdAt: transcript.createdAt,
    device: deviceId,
    format: RECORD_FORMAT,
    id: sessionId,
    imported,
    ...(startedAs !== undefined && { startedAs }),
    t: "session",
  };
  const records: Unsequenced<LogRecord>[] = [header];
  for (const said of transcript.messages) {
    const message = messageOf(said, sessionId, nextId);
    if (!message) {
      continue;
    }
    const { parts, ...bare } = message;
    const at = said.createdAt;
    records.push({ at, message: bare, t: "message" });
    for (const part of parts) {
      records.push({ at, part, t: "part" });
    }
  }
  const settings: Unsequenced<SettingRecord>[] =
    title === undefined
      ? []
      : [
          {
            at: transcript.createdAt,
            device: deviceId,
            field: "title",
            session: sessionId,
            t: "set",
            value: { auto: false, text: title },
          },
        ];

  await fs.mkdir(root, { recursive: true });
  const work = path.join(root, `.~import-${process.pid}-${(staged += 1)}.tmp`);
  await fs.mkdir(work);
  try {
    await writeFile(
      path.join(work, logFileName(sessionId, deviceId)),
      "log",
      records,
    );
    if (settings.length > 0) {
      await writeFile(
        path.join(work, settingsFileName(deviceId)),
        "settings",
        settings,
      );
    }
    await syncDirectory(work);
    // Checked, renamed and placed in one tick, so no chat this process makes
    // can take the id in between, and the index never names a chat whose
    // folder is not whole.
    if (chatIdTaken(chatId)) {
      throw new Error(`A chat already has the id ${chatId}.`);
    }
    renameSync(work, path.join(root, chatId));
    placeChat(chatId, sessionId);
  } catch (error) {
    await fs.rm(work, { force: true, recursive: true });
    throw error;
  }
  await syncDirectory(root);
  rememberImported(chatId, imported);
  recordChanged(chatId, "session");
  return chatId;
}

/**
 * Removes what an import cut off left: a staging folder of a process that is
 * no longer running.
 */
export async function clearStaleImports(): Promise<void> {
  const root = chatsDir();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = STAGING.exec(name)?.[1];
    if (
      pid !== undefined &&
      isStagingFolderName(name) &&
      Number(pid) !== process.pid &&
      !isRunning(Number(pid))
    ) {
      await fs.rm(path.join(root, name), { force: true, recursive: true });
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Running, and someone else's to signal.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * A new chat's id, named for the day the chat began and its title, as a chat
 * started that day would be.
 */
function pickChatId(began: Date, title: string | undefined): ChatId {
  return ChatIdSchema.parse(
    newChatName({ date: began, isTaken: chatIdTaken, title }),
  );
}

/**
 * One message as the app writes its own: the person's with a text part, a
 * reply as a finished one with its words settled. What the source had that
 * does not come across is said in a line at the end. Nothing for a message
 * with no words and nothing left out.
 */
function messageOf(
  imported: ImportedMessage,
  sessionId: StoreId.Session,
  nextId: (seedTime?: number) => string,
): SessionMessage.WithParts | undefined {
  const text = [
    imported.text.trim(),
    omittedLine(imported.omitted, { italic: imported.role === "assistant" }),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (text === "") {
    return undefined;
  }
  const createdAt = imported.createdAt;
  const time = createdAt.getTime();
  const messageId = StoreId.MessageSchema.parse(`msg_${nextId(time)}`);
  const partId = StoreId.PartSchema.parse(`prt_${nextId(time)}`);
  if (imported.role === "user") {
    return {
      id: messageId,
      metadata: { createdAt, sessionId },
      parts: [
        {
          metadata: { createdAt, id: partId, messageId, sessionId },
          text,
          type: "text",
        },
      ],
      role: "user",
    };
  }
  return {
    id: messageId,
    metadata: {
      createdAt,
      finishedAt: createdAt,
      finishReason: "stop",
      modelId: imported.model ?? "unknown",
      providerId: "unknown",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt,
          endedAt: createdAt,
          id: partId,
          messageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "assistant",
  };
}

/**
 * What a message left behind, in a short line the person reads: italic in a
 * reply, which shows as Markdown, and plain in their own message, which
 * shows as typed.
 */
export function omittedLine(
  omitted: ImportOmitted | undefined,
  { italic = true }: { italic?: boolean } = {},
): string {
  const calls = Object.values(omitted?.toolCalls ?? {}).reduce(
    (total, count) => total + count,
    0,
  );
  const attachments = omitted?.attachments ?? 0;
  const said = [
    calls > 0 ? counted(calls, "tool call") : undefined,
    attachments > 0 ? counted(attachments, "attachment") : undefined,
  ].filter((each) => each !== undefined);
  if (said.length === 0) {
    return "";
  }
  const line = `Not imported: ${said.join(" and ")}.`;
  return italic ? `_${line}_` : line;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Writes a file's records in order and syncs it. */
async function writeFile(
  file: string,
  kind: "log" | "settings",
  records: Unsequenced<LogRecord | SettingRecord>[],
): Promise<void> {
  const writer = new RecordWriter(file, chatRecordFormat(kind, file), {
    bytes: new Uint8Array(),
    lastSeq: -1,
  });
  const appended = await Promise.allSettled(
    records.map((record) => writer.append(record)),
  );
  await writer.commit();
  const refused = appended.find((result) => result.status === "rejected");
  if (refused) {
    throw refused.reason instanceof Error
      ? refused.reason
      : new Error(String(refused.reason));
  }
}
