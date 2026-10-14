import { type ChatGrant } from "../../schemas/chat-settings";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { chatDir } from "../record-folders";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { remapMovedPath } from "../moved-paths";

/**
 * The folders granted in a chat, oldest first, each where it is now: a grant
 * stored before a migration moved its folder is read back where it went
 * (`remapMovedPath`).
 */
export async function chatGrants(chatId: ChatId): Promise<ChatGrant[]> {
  const record = await readChatRecord(chatDir(chatId));
  return (record.settings?.grants ?? []).map((grant) => ({
    ...grant,
    path: AbsolutePathSchema.parse(remapMovedPath(grant.path)),
  }));
}

/**
 * Grants a chat a folder, read and write. A path already granted, as stored
 * or where it is now, keeps the grant it has, so a folder sent again keeps
 * its access.
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
    granted = grants.find((grant) => isGrantOf(grant, wanted));
    if (granted) {
      return record.raw;
    }
    granted = { grantedAt: getCurrentDate(), path: wanted, source };
    return { ...record.raw, grants: [...grants, granted] };
  });
  if (!granted) {
    throw new Error(`Folder ${path} was not granted`);
  }
  return { ...granted, path: wanted };
}

/** Takes a folder's grant away from a chat, by its path as stored or as it is now. */
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
      (grant) => !isGrantOf(grant, wanted),
    ),
  }));
}

/** Whether a stored grant is of a folder, by the path it has or the one it moved to. */
function isGrantOf(grant: ChatGrant, folder: string): boolean {
  return grant.path === folder || remapMovedPath(grant.path) === folder;
}
