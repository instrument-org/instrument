import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { parallel, sort } from "radashi";

import { type ChatDir } from "../schemas/paths";
import { type ChatInfo } from "../schemas/chat-info";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { TypedError } from "./errors";
import { getChatDirTimestamps } from "./chat-dir-timestamps";
import { isChatId } from "./is-chat-id";
import { chatDir, chatIds, resolveChat, sessionOfChat } from "./record-folders";
import { chatModelURI } from "./chat-settings";
import { ChatReads } from "./chat-reads";

export interface ChatInfoListOptions {
  direction: "asc" | "desc";
  sortBy: "createdAt" | "updatedAt";
}

export async function getChatInfo(
  id: ChatId,
): Promise<Result<ChatInfo, TypedError.NotFound | TypedError.Parse>> {
  if (!isChatId(id)) {
    return err(new TypedError.Parse("Invalid folder name"));
  }
  if (resolveChat(id) === undefined) {
    return err(new TypedError.NotFound(`No chat has the id ${id}.`));
  }
  const dir = chatDir(id);
  try {
    await fs.access(dir);
  } catch (error) {
    return err(new TypedError.NotFound("App not found", { cause: error }));
  }

  return readChatInfo({ dir });
}

export async function getChatInfos(
  options: ChatInfoListOptions,
): Promise<ChatInfo[]> {
  const dirs = chatIds().map((chatId) => chatDir(chatId));
  // Read chats concurrently; each readChatInfo is several independent fs ops
  // and a workspace can hold many chats, so a serial loop dominates latency.
  const results = await parallel({ limit: 12 }, dirs, (dir) =>
    readChatInfo({ dir }),
  );
  // Folders whose name isn't a valid chat id are skipped silently. They are a
  // recoverable, user-visible condition (listed in the Storage settings tab),
  // not a bug.
  const chats = results
    .filter((result) => result.isOk())
    .map((result) => result.value);

  return sortChatInfos(chats, options);
}

async function readChatInfo({ dir }: { dir: ChatDir }) {
  const rawFolderName = path.basename(dir);
  const parsed = ChatIdSchema.safeParse(rawFolderName);

  if (!parsed.success) {
    return err(
      new TypedError.Parse("Invalid folder name", { cause: parsed.error }),
    );
  }

  const title = await chatTitle(parsed.data);
  const modelURI = await chatModelURI(parsed.data);
  const info: ChatInfo = {
    ...(await chatTimestamps(parsed.data, dir)),
    id: parsed.data,
    ...(modelURI ? { modelURI } : {}),
    title: title ?? rawFolderName,
  };
  return ok(info);
}

/**
 * The app version the chat began on, from the first log of its own session,
 * or nothing for a chat with no records to read.
 */
export async function chatStartedWithApp(
  chatId: ChatId,
): Promise<string | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return undefined;
  }
  const app = await ChatReads.startedWithApp({ chatId, sessionId });
  return app.isOk() ? app.value : undefined;
}

/** A chat's title, from its own session's row, which is where a rename writes it. */
export async function chatTitle(chatId: ChatId): Promise<string | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return undefined;
  }
  const session = await ChatReads.session({ chatId, sessionId });
  return session.isOk() ? session.value.title : undefined;
}

/** The order the list asks for, over a set already read. */
function sortChatInfos(
  chats: ChatInfo[],
  { direction, sortBy }: ChatInfoListOptions,
): ChatInfo[] {
  const sortByFn =
    sortBy === "createdAt"
      ? (chat: ChatInfo) => chat.createdAt.getTime()
      : (chat: ChatInfo) => chat.updatedAt.getTime();

  return sort(chats, (chat) => (direction === "asc" ? 1 : -1) * sortByFn(chat));
}

/**
 * When the chat was made and when something last happened in it, from its
 * records: its own session's start, and the newest record any of its
 * sessions wrote. A setting (a star, a read mark, a model pick) is not
 * something happening in the chat, and moves neither.
 *
 * The folder's own timestamps answer only for a chat with no records to
 * read, one still on its `chat.db`.
 */
async function chatTimestamps(
  id: ChatId,
  dir: ChatDir,
): Promise<{ createdAt: Date; updatedAt: Date }> {
  const sessionId = sessionOfChat(id);
  const sessions = await ChatReads.sessions({
    chatId: id,
    includeChildSessions: true,
  });
  const own = sessions.isOk()
    ? sessions.value.find((session) => session.id === sessionId)
    : undefined;
  if (!sessions.isOk() || !own) {
    return getChatDirTimestamps(dir);
  }
  return {
    createdAt: own.createdAt,
    updatedAt: new Date(
      Math.max(
        ...sessions.value.map((session) => session.updatedAt?.getTime() ?? 0),
      ),
    ),
  };
}
