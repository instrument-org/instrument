import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatAttachmentsDir, handoffNotesPath } from "../chat-dir-utils";
import { rewriteChatFolder } from "../chat-folders/write-chat-folder";
import { ChatReads } from "../chat-reads";
import { chatModelURI, setChatModel } from "../chat-settings";
import { ChatWrites } from "../chat-writes";
import { TypedError } from "../errors";
import {
  readChatPermissions,
  updateChatPermissions,
} from "../permissions/rules";
import { chatDir, sessionOfChat } from "../record-folders";
import { BLOBS_FOLDER_NAME, blobPath, isBlobName } from "../records/blobs";
import { chatPlaces } from "./chat-for-agent";
import { ensureChat } from "./chat-records";
import { listChats, renameChat, setChatProject } from "./chats";

/**
 * Starts a new chat from one of a chat's replies: the chat's own
 * conversation up to and including `upTo`, copied rather than pointed at,
 * so the branch stands whole if the chat it came from is deleted. It is
 * named for that chat with the next free number after it, and keeps its
 * project, its model and what it was allowed and refused on this computer.
 * Its tasks are not copied: their cards show the work they did and open
 * nothing. Its work folder starts empty.
 *
 * The copy ends with a note for the agent, never a message from the person,
 * naming the chat it came from and where that chat's folders are, so it can
 * reach back for a file the conversation made.
 */
export async function branchChat({
  chatId,
  upTo,
}: {
  chatId: ChatId;
  /** The last message the branch carries: the end of the reply it was started from. */
  upTo: StoreId.Message;
}): Promise<ChatId> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new TypedError.NotFound(`${chatId} is not a chat.`);
  }
  const [session, history] = await Promise.all([
    ChatReads.session({ chatId, sessionId }),
    ChatReads.developerHistory({ chatId, sessionId }),
  ]);
  if (session.isErr()) {
    throw session.error;
  }
  if (history.isErr()) {
    throw history.error;
  }
  const end = history.value.findIndex((message) => message.id === upTo);
  if (end === -1) {
    throw new TypedError.NotFound(`${chatId} has no message ${upTo}.`);
  }
  const copied = history.value.slice(0, end + 1);

  const [places, model, permissions, listed] = await Promise.all([
    chatPlaces(chatId),
    chatModelURI(chatId),
    readChatPermissions(chatId),
    listChats(),
  ]);
  const title = branchTitle(
    places.title,
    new Set(listed.map((chat) => chat.title)),
  );

  const branchSession = StoreId.newSessionId();
  const branch = await ensureChat(branchSession, title);

  for (const message of copied) {
    const written = await ChatWrites.saveMessageWithParts(
      inSession(message, branchSession),
      branch,
    );
    if (written.isErr()) {
      throw written.error;
    }
  }
  await copyFilesNamed(copied, chatId, branch);

  const rolledOver = session.value.rolledOverAfterMessageId;
  if (
    rolledOver !== undefined &&
    copied.some((message) => message.id === rolledOver)
  ) {
    await carryRollover(branch, branchSession, session.value);
    // What the agent wrote down for after a reset is what it reads in place
    // of the messages before it.
    await copyIfThere(
      handoffNotesPath(chatDir(chatId)),
      handoffNotesPath(chatDir(branch)),
    );
  }

  await renameChat(branch, title);
  if (session.value.project !== undefined) {
    await setChatProject(branch, session.value.project);
  }
  if (model !== undefined) {
    const set = await setChatModel(branch, model);
    if (set.isErr()) {
      throw set.error;
    }
  }
  await updateChatPermissions(branch, () => permissions);

  const createdAt = new Date();
  const noteId = StoreId.newMessageId();
  const note = await ChatWrites.saveMessageWithParts(
    {
      id: noteId,
      metadata: { createdAt, sessionId: branchSession },
      parts: [
        {
          data: {
            chat: chatId,
            ...(places.chatFolder !== undefined && {
              folder: places.chatFolder,
            }),
            records: places.recordsFolder,
            title: places.title,
            work: places.workFolder,
          },
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: noteId,
            sessionId: branchSession,
          },
          type: "data-branchedFrom",
        },
      ],
      role: "user",
    },
    branch,
  );
  if (note.isErr()) {
    throw note.error;
  }
  // The folder has its `CHAT.md` now rather than at the branch's first
  // turn, and what the person sent moves into it.
  await rewriteChatFolder(branch);
  return branch;
}

/**
 * A branch's title: the chat's with the next number no chat has after it,
 * `Pricing 2`, then `Pricing 3`. A branch of a branch counts on from the
 * same chat, so `Pricing 2` branches into `Pricing 3` rather than
 * `Pricing 2 2`, when a chat named for the words before the number is there.
 */
export function branchTitle(title: string, taken: ReadonlySet<string>): string {
  const numbered = /^(.*\S) \d+$/.exec(title);
  const base =
    numbered?.[1] !== undefined && taken.has(numbered[1]) ? numbered[1] : title;
  for (let number = 2; ; number += 1) {
    const candidate = `${base} ${number.toString()}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** The message and each of its parts as the branch's session holds them. */
function inSession(
  message: SessionMessage.WithParts,
  sessionId: StoreId.Session,
): SessionMessage.WithParts {
  // A copy changed in place, since a spread of either union loses which of
  // its members each message and part is.
  const copy = structuredClone(message);
  copy.metadata.sessionId = sessionId;
  for (const part of copy.parts) {
    part.metadata.sessionId = sessionId;
  }
  return copy;
}

/**
 * Copies into the branch's record folder the blobs its parts name and the
 * files the person sent in the copied messages, so each still opens there.
 * A file the person sent is put in the record folder, and writing the
 * branch's own folder moves it in, as it does for any send.
 */
async function copyFilesNamed(
  messages: readonly SessionMessage.WithParts[],
  from: ChatId,
  to: ChatId,
): Promise<void> {
  const source = chatDir(from);
  const target = chatDir(to);
  const blobs = new Set<string>();
  const sent = new Set<string>();
  const attachments = `${CHAT_FOLDER_NAMES.attachments}/`;
  for (const message of messages) {
    for (const part of message.parts) {
      for (const name of JSON.stringify(part).match(BLOB_NAMES) ?? []) {
        if (isBlobName(name)) {
          blobs.add(name);
        }
      }
      if (part.type === "data-attachments") {
        for (const file of part.data.files) {
          const bare = file.filePath.replace(/^\.\//, "");
          if (bare.startsWith(attachments)) {
            sent.add(bare.slice(attachments.length));
          }
        }
      }
    }
  }
  if (blobs.size > 0) {
    await fs.mkdir(path.join(target, BLOBS_FOLDER_NAME), { recursive: true });
  }
  for (const name of blobs) {
    await copyIfThere(blobPath(source, name), blobPath(target, name));
  }
  if (sent.size > 0) {
    await fs.mkdir(path.join(target, CHAT_FOLDER_NAMES.attachments), {
      recursive: true,
    });
  }
  const sentFrom = chatAttachmentsDir(source);
  for (const name of sent) {
    await copyIfThere(
      path.join(sentFrom, name),
      path.join(target, CHAT_FOLDER_NAMES.attachments, name),
    );
  }
}

const BLOB_NAMES = /sha256-[0-9a-f]{64}\.[0-9a-z]+/g;

/** Copies a file that is there, leaving one already at the target as it is. */
async function copyIfThere(from: string, to: string): Promise<void> {
  try {
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT" && code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Where the chat's context window was last reset, for a branch that carries
 * the message it was reset after, so the branch sends what the chat sent.
 */
async function carryRollover(
  branch: ChatId,
  sessionId: StoreId.Session,
  from: {
    rolledOverAfterMessageId?: StoreId.Message;
    rolledOverUnderUsableTokens?: number;
    rolloverWindows?: Parameters<
      typeof ChatWrites.saveSession
    >[0]["rolloverWindows"];
  },
): Promise<void> {
  const session = await ChatReads.session({ chatId: branch, sessionId });
  if (session.isErr()) {
    throw session.error;
  }
  const saved = await ChatWrites.saveSession(
    {
      ...session.value,
      rolledOverAfterMessageId: from.rolledOverAfterMessageId,
      ...(from.rolledOverUnderUsableTokens !== undefined && {
        rolledOverUnderUsableTokens: from.rolledOverUnderUsableTokens,
      }),
      ...(from.rolloverWindows !== undefined && {
        rolloverWindows: from.rolloverWindows,
      }),
    },
    branch,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
}
