import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type HeldTab } from "../schemas/chat-state";
import { isTaskSession } from "./chat/children";
import { chatDir } from "./record-folders";
import { getChatState, updateChatState } from "./chat-record";

/**
 * The tabs a session of a chat drives, first one first: the chat's
 * conversation drives the tabs that name no driver, and each task of the
 * chat those that name its session.
 */
export async function heldTabs(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<HeldTab[]> {
  const driver = driverOf(chatId, sessionId);
  return (await getChatState(chatDir(chatId))).browserTabs.filter(
    (tab) => tab.driver === driver,
  );
}

/**
 * Replaces the tabs a session drives with `change` of them, leaving every
 * other session's where they are. A tab is driven by one session at a time,
 * so one `change` adds is taken from whichever session drove it.
 */
export async function updateHeldTabs(
  chatId: ChatId,
  sessionId: StoreId.Session,
  change: (tabs: HeldTab[]) => HeldTab[],
): Promise<void> {
  const driver = driverOf(chatId, sessionId);
  await updateChatState(chatDir(chatId), ({ browserTabs }) => {
    const mine = change(browserTabs.filter((tab) => tab.driver === driver)).map(
      ({ driver: _driver, ...tab }) =>
        driver === undefined ? tab : { ...tab, driver },
    );
    const taken = new Set(mine.map((tab) => tab.id));
    return {
      browserTabs: [
        ...browserTabs.filter(
          (tab) => tab.driver !== driver && !taken.has(tab.id),
        ),
        ...mine,
      ],
    };
  });
}

/**
 * Gives the tabs a task drove back to the chat, as the task finishes: still
 * open in the window, now the conversation's to work in.
 */
export async function returnTabsToChat(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<void> {
  await updateChatState(chatDir(chatId), ({ browserTabs }) => ({
    browserTabs: browserTabs.map(({ driver, ...tab }) =>
      driver === sessionId ? tab : { ...tab, ...(driver ? { driver } : {}) },
    ),
  }));
}

/** The session a tab names as its driver: a task's own, none for the chat's. */
function driverOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): StoreId.Session | undefined {
  return isTaskSession(chatId, sessionId) ? sessionId : undefined;
}
