import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { owningChat, sessionOfChat } from "../record-folders";
import { getWindowState, updateWindowState } from "../window-state";

/** The chat an app was last asked for in, or none for an app nobody asked for. */
export async function chatOfApp({
  slug,
}: {
  slug: string;
}): Promise<ChatId | undefined> {
  const state = await getWindowState();
  return state.appChats?.[slug];
}

/**
 * The chat a task was started in: the chat whose folder it is in. A task
 * reports back into that chat, whichever is newest when it finishes.
 */
export function chatOfTask(taskId: TaskId): StoreId.Session | undefined {
  const chatId = owningChat(taskId);
  return chatId === undefined ? undefined : sessionOfChat(chatId);
}

/**
 * Which chat an app was asked for in.
 *
 * A sign-in finishes in the browser and a key is saved on a card, neither of
 * which knows a chat, so the ask records where it was made and the event
 * that answers it is delivered there rather than to whichever chat is
 * newest. Recorded on each ask, so an app asked for again from another
 * chat reports into that one. Kept in the window's state, since the event
 * arrives for the window and has to find the chat from there.
 */
export async function recordAppChat({
  chatId,
  slug,
}: {
  chatId: ChatId;
  slug: string;
}): Promise<void> {
  await updateWindowState((state) => ({
    appChats: { ...state.appChats, [slug]: chatId },
  }));
}
