import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { sessionOfChat } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { windowTaskId } from "./ensure";

/** The chat an app was last asked for in, or none for an app nobody asked for. */
export async function chatOfApp({
  slug,
}: {
  slug: string;
}): Promise<StoreId.Session | undefined> {
  const state = await getTaskState(taskDir(await windowTaskId()));
  return state.appChats?.[slug];
}

/**
 * The chat a task was started in: its parent, when its parent is a chat. A
 * task reports back into that chat, whichever is newest when it finishes.
 */
export async function chatOfTask(
  taskId: TaskId,
): Promise<StoreId.Session | undefined> {
  const settings = await getTaskSettings(taskDir(taskId));
  return settings?.parentTaskId === undefined
    ? undefined
    : sessionOfChat(settings.parentTaskId);
}

/**
 * Which chat an app was asked for in.
 *
 * A sign-in finishes in the browser and a key is saved on a card, neither of
 * which knows a chat, so the ask records where it was made and the event
 * that answers it is delivered there rather than to whichever chat is
 * newest. Recorded on each ask, so an app asked for again from another
 * chat reports into that one. Kept on the window's record, since the event
 * arrives for the window and has to find the chat from there.
 */
export async function recordAppChat({
  sessionId,
  slug,
}: {
  sessionId: StoreId.Session;
  slug: string;
}): Promise<void> {
  await updateTaskState(taskDir(await windowTaskId()), (state) => ({
    appChats: { ...state.appChats, [slug]: sessionId },
  }));
}
