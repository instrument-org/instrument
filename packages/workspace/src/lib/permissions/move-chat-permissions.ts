import { type ChatId } from "../../schemas/chat-id";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { chatDir, chatIds } from "../record-folders";
import { updatePermissionSettings } from "./rules";

/**
 * Brings what each chat allowed out of its own `settings.json` and into this
 * computer's permission settings, where the rest of the folder and app rules
 * already are.
 *
 * They were written beside the chat, which travels with the workspace, and
 * every one of them names something on this computer: a folder by its
 * absolute path, a Mac app by its bundle id. A workspace opened on another
 * computer read them as its own, and a path written on a Mac resolves on
 * Windows to a different folder of the same name, which opened it without
 * anyone being asked.
 *
 * Safe to run again: a chat whose settings no longer carry any of the three
 * is passed over, and a chat already moved has nothing left to move. What is
 * already held here wins, so a second run never writes over an answer given
 * since the first.
 */
export async function moveChatPermissions(): Promise<{ moved: number }> {
  const held = new Map<
    ChatId,
    { appGrants: unknown[]; denials: unknown[]; grants: unknown[] }
  >();
  for (const id of chatIds()) {
    const record = await readChatRecord(chatDir(id));
    const { appGrants, denials, grants } = record.settings ?? {};
    if (!appGrants?.length && !denials?.length && !grants?.length) {
      continue;
    }
    held.set(id, {
      appGrants: appGrants ?? [],
      denials: denials ?? [],
      grants: grants ?? [],
    });
  }
  if (held.size === 0) {
    return { moved: 0 };
  }
  await updatePermissionSettings((settings) => {
    const chats = { ...settings.chats };
    for (const [id, carried] of held) {
      // Anything answered here since a previous run is what the person meant
      // last, so it stays.
      if (chats[id]) {
        continue;
      }
      chats[id] = carried as (typeof chats)[string];
    }
    return { ...settings, chats };
  });
  // Only once the new home holds them, so a crash between the two leaves the
  // chat's copy to be moved again rather than losing it.
  for (const id of held.keys()) {
    // The record file merges a change into what is there, so a key goes by
    // being set to undefined rather than by being left out.
    await updateChatRecord(chatDir(id), () => ({
      appGrants: undefined,
      denials: undefined,
      grants: undefined,
    }));
  }
  return { moved: held.size };
}
