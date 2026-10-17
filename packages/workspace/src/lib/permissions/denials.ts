import { type ChatId } from "../../schemas/chat-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { getCurrentDate } from "../get-current-date";
import {
  type ChatDenial,
  readChatPermissions,
  updateChatPermissions,
} from "./rules";

/** What the person said not now to in a chat, oldest first. */
export async function chatDenials(chatId: ChatId): Promise<ChatDenial[]> {
  if (chatId === WINDOW_ID) {
    return [];
  }
  return (await readChatPermissions(chatId)).denials;
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
  await updateChatPermissions(chatId, (held) => {
    const others = held.denials.filter(
      (denial) => !(denial.kind === kind && denial.target === target),
    );
    return {
      ...held,
      denials: denied
        ? [...others, { deniedAt: getCurrentDate(), kind, target }]
        : others,
    };
  });
}
