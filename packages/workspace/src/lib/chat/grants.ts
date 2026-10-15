import {
  type ChatGrant,
  readChatPermissions,
  updateChatPermissions,
} from "../permissions/rules";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getCurrentDate } from "../get-current-date";
import { remapMovedPath } from "../moved-paths";

/**
 * The folders granted in a chat, oldest first, each where it is now: a grant
 * stored before a migration moved its folder is read back where it went
 * (`remapMovedPath`).
 *
 * Kept on this computer rather than in the chat, since every one of them
 * names a folder here; see `chats` in the permission settings.
 */
export async function chatGrants(chatId: ChatId): Promise<ChatGrant[]> {
  const held = await readChatPermissions(chatId);
  return held.grants.map((grant) => ({
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
  return addGrant(chatId, { path, source });
}

/**
 * Grants a chat a file the user sent, read and write, where it is on disk:
 * the rules open that file alone, whatever its folder's place says.
 */
export async function grantFile({
  chatId,
  path,
}: {
  chatId: ChatId;
  path: string;
}): Promise<ChatGrant> {
  return addGrant(chatId, { kind: "file", path, source: "attached" });
}

async function addGrant(
  chatId: ChatId,
  {
    kind,
    path,
    source,
  }: { kind?: ChatGrant["kind"]; path: string; source: ChatGrant["source"] },
): Promise<ChatGrant> {
  const wanted = AbsolutePathSchema.parse(path);
  let granted: ChatGrant | undefined;
  await updateChatPermissions(chatId, (held) => {
    granted = held.grants.find((grant) => isGrantOf(grant, wanted));
    if (granted) {
      return held;
    }
    granted = {
      grantedAt: getCurrentDate(),
      ...(kind && { kind }),
      path: wanted,
      source,
    };
    return { ...held, grants: [...held.grants, granted] };
  });
  if (!granted) {
    throw new Error(`${path} was not granted`);
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
  await updateChatPermissions(chatId, (held) => ({
    ...held,
    grants: held.grants.filter((grant) => !isGrantOf(grant, wanted)),
  }));
}

/** Whether a stored grant is of a folder, by the path it has or the one it moved to. */
function isGrantOf(grant: ChatGrant, folder: string): boolean {
  return grant.path === folder || remapMovedPath(grant.path) === folder;
}
