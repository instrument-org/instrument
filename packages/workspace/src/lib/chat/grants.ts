import {
  type ChatGrant,
  readChatPermissions,
  updateChatPermissions,
} from "../permissions/rules";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getCurrentDate } from "../get-current-date";

/**
 * The folders granted in a chat, oldest first.
 *
 * Kept on this computer rather than in the chat, since every one of them
 * names a folder here; see `chats` in the permission settings.
 */
export async function chatGrants(chatId: ChatId): Promise<ChatGrant[]> {
  const held = await readChatPermissions(chatId);
  return held.grants;
}

/**
 * Grants a chat a folder, read and write. A path already granted keeps the
 * grant it has, so a folder sent again keeps its access.
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

/** Whether a stored grant is of a folder, by the path it has. */
function isGrantOf(grant: ChatGrant, folder: string): boolean {
  return grant.path === folder;
}
