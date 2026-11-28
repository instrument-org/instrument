import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { type ClosedTab } from "../../schemas/chat-state";
import { type BrowserTargetId } from "../../types";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, sessionOfChat } from "../record-folders";
import { actsIn } from "../tab-activity";
import { isWorking } from "./activity";
import { listChildTasks } from "./children";
import { chatPageTabs } from "./chat-page-tabs";
import { takePendingUse } from "./person-used-tabs";

export {
  agentTabIdOf,
  type ChatPageTab,
  chatPageTabs,
  type ChatTabs,
  chatTabs,
  openedTabId,
  pageTabNamed,
} from "./chat-page-tabs";

/**
 * Keeps a tab a session of the chat opened, by the id agents name it by,
 * which counts toward `CHAT_HIDDEN_TAB_CAP` and closes with the chat's
 * archiving (`tab-cap.ts`).
 */
export async function noteOpenedTab(
  chatId: ChatId,
  id: BrowserTargetId,
  openedIn: StoreId.Session,
): Promise<void> {
  await updateChatState(chatDir(chatId), ({ openedTabs }) => {
    const used =
      takePendingUse(id) ||
      openedTabs.some((tab) => tab.id === id && tab.usedByPerson);
    return {
      openedTabs: [
        ...openedTabs.filter((tab) => tab.id !== id),
        { id, openedIn, ...(used ? { usedByPerson: true as const } : {}) },
      ],
    };
  });
}

/** Forgets tabs that are gone or closing, so nothing counts or closes them again. */
export async function forgetOpenedTabs(
  chatId: ChatId,
  ids: ReadonlySet<string>,
): Promise<void> {
  await updateChatState(chatDir(chatId), ({ openedTabs }) => ({
    openedTabs: openedTabs.filter((tab) => !ids.has(tab.id)),
  }));
}

/**
 * Keeps word of a tab the chat closed while a task worked in it, for that
 * task's next browser command or note to say. `movedOut` for one the chat
 * moved to another tab group instead, where the task's agent-browser no
 * longer reaches it.
 */
export async function noteTabClosedByChat(
  chatId: ChatId,
  tab: { id: string; session: StoreId.Session; url: string },
  reason: "chat" | "movedOut" = "chat",
): Promise<void> {
  await updateChatState(chatDir(chatId), (state) => ({
    closedTabs: [
      ...state.closedTabs.filter((each) => each.id !== tab.id),
      { ...tab, reason },
    ],
  }));
}

/**
 * The tabs closed out from under the session since it was last told, by the
 * app or by the chat, taken from the chat's state: whoever reads them tells
 * it. The chat's own
 * conversation hears of the ones that name no session.
 */
export async function takeClosedTabs(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<ClosedTab[]> {
  const told = (tab: ClosedTab) =>
    (tab.session ?? sessionOfChat(chatId)) === sessionId;
  const { closedTabs } = await getChatState(chatDir(chatId));
  if (!closedTabs.some(told)) {
    return [];
  }
  let taken: ClosedTab[] = [];
  await updateChatState(chatDir(chatId), (state) => {
    taken = state.closedTabs.filter(told);
    return { closedTabs: state.closedTabs.filter((tab) => !told(tab)) };
  });
  return taken;
}

/**
 * The sessions with a turn running that sent a tab commands, the latest
 * first: who is at work in it, by the id agents name it by. Free while
 * nothing has driven the tab.
 */
export function workingIn(tabId: string) {
  return actsIn(tabId).filter((act) => isWorkingNow(act));
}

/** A task at work in a tab: by its handle, its session and its title. */
interface TabHolder {
  id: string;
  session: StoreId.Session;
  title: string;
}

/**
 * The tasks of a chat at work in each of its tabs, by the tab's id, the one
 * that acted last when several are: what lets the conversation see who is
 * using a page before it closes or replaces it, and a task tell its own
 * work from another's.
 */
export async function tabHolders(
  chatId: ChatId,
): Promise<Map<string, TabHolder>> {
  const holders = new Map<string, TabHolder>();
  const working = await listChildTasks(chatId, (id) =>
    isWorkingNow({ chatId, sessionId: id }),
  );
  if (working.length === 0) {
    return holders;
  }
  const tabs = await chatPageTabs(chatId);
  for (const tab of tabs ?? []) {
    const holder = actsIn(tab.id)
      .map((act) => working.find((task) => task.id === act.sessionId))
      .find((task) => task !== undefined);
    if (holder) {
      // By its handle, which is what the conversation steers it by.
      holders.set(tab.id, {
        id: holder.handle,
        session: holder.id,
        title: holder.title,
      });
    }
  }
  return holders;
}

/** Whether a session is working, or false where no workspace is running to ask. */
export function isWorkingNow({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: Parameters<typeof isWorking>[1];
}): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
