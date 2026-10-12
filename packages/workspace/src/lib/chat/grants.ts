import { type ChatGrant } from "../../schemas/chat-settings";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { chatDir } from "../record-folders";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { getCurrentDate } from "../get-current-date";

/** The folders granted in a chat, oldest first. */
export async function chatGrants(chatId: ChatId): Promise<ChatGrant[]> {
  const record = await readChatRecord(chatDir(chatId));
  return record.settings?.grants ?? [];
}

/**
 * Grants a chat a folder, read and write. A path already granted keeps the
 * grant it has, and with it the mount name it was given, so a folder sent
 * again never moves under the agent.
 */
export async function grantFolder({
  chatId,
  path,
  source,
}: {
  chatId: ChatId;
  path: string;
  source: ChatGrant["source"];
}): Promise<ChatGrant> {
  const wanted = AbsolutePathSchema.parse(path);
  let granted: ChatGrant | undefined;
  await updateChatRecord(chatDir(chatId), "settings", (record) => {
    const grants = record.settings?.grants ?? [];
    granted = grants.find((grant) => grant.path === wanted);
    if (granted) {
      return record.raw;
    }
    granted = { grantedAt: getCurrentDate(), path: wanted, source };
    return { ...record.raw, grants: [...grants, granted] };
  });
  if (!granted) {
    throw new Error(`Folder ${path} was not granted`);
  }
  return granted;
}

/** Takes a folder's grant away from a chat, by its path. */
export async function revokeGrant({
  chatId,
  path,
}: {
  chatId: ChatId;
  path: string;
}): Promise<void> {
  const wanted = AbsolutePathSchema.parse(path);
  await updateChatRecord(chatDir(chatId), "settings", (record) => ({
    ...record.raw,
    grants: (record.settings?.grants ?? []).filter(
      (grant) => grant.path !== wanted,
    ),
  }));
}
