import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { assign, parallel, sort } from "radashi";

import { type ChatDir } from "../schemas/paths";
import { type ChatInfo } from "../schemas/chat-info";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { type ChatSettings } from "../schemas/chat-settings";
import { TypedError } from "./errors";
import { getTaskDirTimestamps } from "./get-task-dir-timestamps";
import { isChatId } from "./is-chat-id";
import { chatDir, chatIds, resolveChat } from "./record-folders";
import { getChatSettings } from "./chat-settings";

export interface ChatInfoListOptions {
  direction?: "asc" | "desc";
  limit?: number;
  sortBy?: "createdAt" | "updatedAt";
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
  options: ChatInfoListOptions = {},
): Promise<{ chats: ChatInfo[]; total: number }> {
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

  const settings = await getChatSettings(dir);
  const info: ChatInfo = {
    ...(await chatTimestamps(dir, settings)),
    apps: settings?.apps,
    id: parsed.data,
    ...(settings?.modelURI ? { modelURI: settings.modelURI } : {}),
    reasoningEffort: settings?.reasoningEffort,
    title: settings?.name ?? rawFolderName,
  };
  return ok(info);
}

/** The order and window the list asks for, over a set already read. */
function sortChatInfos(
  chats: ChatInfo[],
  options: ChatInfoListOptions = {},
): { chats: ChatInfo[]; total: number } {
  const { direction, limit, sortBy } = assign(
    {
      direction: "desc",
      sortBy: "updatedAt",
    },
    options,
  );
  const sortByFn =
    sortBy === "createdAt"
      ? (chat: ChatInfo) => chat.createdAt.getTime()
      : (chat: ChatInfo) => chat.updatedAt.getTime();

  const sorted = sort(
    chats,
    (chat) => (direction === "asc" ? 1 : -1) * sortByFn(chat),
  );

  const total = sorted.length;

  if (limit !== undefined) {
    return { chats: sorted.slice(0, limit), total };
  }

  return { chats: sorted, total };
}

/**
 * When the chat was made and when something last happened in it.
 *
 * Both are written to settings when the chat is created, so the usual answer
 * is the file already read above and the folder is never touched. It is
 * consulted only for a chat missing one of them: one restored by hand, or one
 * whose settings cannot be read.
 */
async function chatTimestamps(
  dir: ChatDir,
  settings: ChatSettings | undefined,
): Promise<{ createdAt: Date; updatedAt: Date }> {
  if (settings?.createdAt && settings.lastActivityAt) {
    return {
      createdAt: settings.createdAt,
      updatedAt: settings.lastActivityAt,
    };
  }

  const observed = await getTaskDirTimestamps(dir);
  return {
    createdAt: settings?.createdAt ?? observed.createdAt,
    updatedAt: settings?.lastActivityAt ?? observed.updatedAt,
  };
}
