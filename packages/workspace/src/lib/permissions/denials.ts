import { type ChatId } from "../../schemas/chat-id";
import { type ChatDenial } from "../../schemas/chat-settings";
import { WINDOW_ID } from "../../schemas/window-id";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { chatDir } from "../record-folders";

/** What the person said not now to in a chat, oldest first. */
export async function chatDenials(chatId: ChatId): Promise<ChatDenial[]> {
  if (chatId === WINDOW_ID) {
    return [];
  }
  const record = await readChatRecord(chatDir(chatId));
  return record.settings?.denials ?? [];
}

/**
 * Records a "not now", or takes one back when the person allows the same
 * thing later.
 */
export async function setDenied(
  chatId: ChatId,
  kind: ChatDenial["kind"],
  target: string,
  denied: boolean,
): Promise<void> {
  await updateChatRecord(chatDir(chatId), "settings", (record) => {
    const others = (record.settings?.denials ?? []).filter(
      (denial) => !(denial.kind === kind && denial.target === target),
    );
    return {
      ...record.raw,
      denials: denied
        ? [...others, { deniedAt: getCurrentDate(), kind, target }]
        : others,
    };
  });
}
