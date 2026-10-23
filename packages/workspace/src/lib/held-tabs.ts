import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ClosedTab, type HeldTab } from "../schemas/chat-state";
import { sessionRole } from "./chat/children";
import { chatDir } from "./record-folders";
import { getChatState, updateChatState } from "./chat-record";
import { getWorkspaceConfig } from "./workspace-config";

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
 * The tabs of the session's the app closed on its own since it was last
 * told, taken from the chat's state: whoever reads them tells the session.
 */
export async function takeClosedTabs(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<ClosedTab[]> {
  const driver = driverOf(chatId, sessionId);
  const { closedTabs } = await getChatState(chatDir(chatId));
  if (!closedTabs.some((tab) => tab.driver === driver)) {
    return [];
  }
  let taken: ClosedTab[] = [];
  await updateChatState(chatDir(chatId), (state) => {
    taken = state.closedTabs.filter((tab) => tab.driver === driver);
    return {
      closedTabs: state.closedTabs.filter((tab) => tab.driver !== driver),
    };
  });
  return taken;
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

/**
 * Closes the pages a session asked for and never sent anywhere, as its turn
 * ends: they have no tab in the chat, so nothing of them is left behind.
 */
export async function closePagesWithNoTab(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<void> {
  const pending = (await heldTabs(chatId, sessionId)).filter(
    (tab) => !tab.inWindow,
  );
  if (pending.length === 0) {
    return;
  }
  const { browser } = getWorkspaceConfig();
  await Promise.all(pending.map((tab) => browser.closeTarget(tab.id)));
  await updateHeldTabs(chatId, sessionId, (tabs) =>
    tabs.filter((tab) => tab.inWindow),
  );
}

/** The session a tab names as its driver: a task's own, none for the chat's. */
function driverOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): StoreId.Session | undefined {
  return sessionRole(chatId, sessionId) === "task" ? sessionId : undefined;
}
