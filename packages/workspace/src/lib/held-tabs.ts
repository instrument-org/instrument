import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type HeldTab } from "../schemas/chat-state";
import { isTaskSession } from "./chat/children";
import { chatDir } from "./record-folders";
import { getChatState, updateChatState } from "./chat-record";

/**
 * The tabs a session of a record drives, first one first: a chat's
 * conversation drives the record's tabs that name no session, and each task
 * of the chat those that name its own.
 */
export async function heldTabs(
  taskId: ChatId,
  sessionId: StoreId.Session,
): Promise<HeldTab[]> {
  const driver = driverOf(taskId, sessionId);
  return (await getChatState(chatDir(taskId))).browserTabs.filter(
    (tab) => tab.sessionId === driver,
  );
}

/**
 * Replaces the tabs a session drives with `change` of them, leaving every
 * other session's where they are.
 */
export async function updateHeldTabs(
  taskId: ChatId,
  sessionId: StoreId.Session,
  change: (tabs: HeldTab[]) => HeldTab[],
): Promise<void> {
  const driver = driverOf(taskId, sessionId);
  await updateChatState(chatDir(taskId), ({ browserTabs }) => ({
    browserTabs: [
      ...browserTabs.filter((tab) => tab.sessionId !== driver),
      ...change(browserTabs.filter((tab) => tab.sessionId === driver)).map(
        ({ sessionId: _driver, ...tab }) =>
          driver === undefined ? tab : { ...tab, sessionId: driver },
      ),
    ],
  }));
}

/** The session a tab names as its driver: a task's own, none for the chat's. */
function driverOf(
  taskId: ChatId,
  sessionId: StoreId.Session,
): StoreId.Session | undefined {
  return isTaskSession(taskId, sessionId) ? sessionId : undefined;
}
