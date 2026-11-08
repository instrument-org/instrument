import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { type ClosedTab } from "../../schemas/chat-state";
import { type WindowTabAnswer } from "../../schemas/window-tab";
import { type BrowserTargetId, parseBrowserTargetId } from "../../types";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat, sessionOfChat } from "../record-folders";
import { actsIn } from "../tab-activity";
import { isWorking } from "./activity";
import { listChildTasks } from "./children";
import { askWindow } from "./window-tab";

/** A page tab of the chat's, as the window lists it. */
export type ChatPageTab = Extract<
  NonNullable<WindowTabAnswer["tabs"]>[number],
  { kind: "page" }
> & { targetId: BrowserTargetId };

/**
 * The chat's page tabs, as the window has them now, in the strip's order:
 * every one is every session's to see and drive. Undefined when no window
 * answered.
 */
export async function chatPageTabs(
  chatId: ChatId,
): Promise<ChatPageTab[] | undefined> {
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: chatId,
    group: resolveChat(chatId),
  });
  if (!answer?.tabs) {
    return undefined;
  }
  return answer.tabs.flatMap((tab) => {
    const targetId = parseBrowserTargetId(tab.id);
    return tab.kind === "page" && targetId !== null
      ? [{ ...tab, targetId }]
      : [];
  });
}

/** Keeps a tab a session of the chat opened, which closes once nobody can still be working in it (`closeTurnTabs`). */
export async function noteOpenedTab(
  chatId: ChatId,
  id: BrowserTargetId,
  openedIn: StoreId.Session,
): Promise<void> {
  await updateChatState(chatDir(chatId), ({ openedTabs }) => ({
    openedTabs: [
      ...openedTabs.filter((tab) => tab.id !== id),
      { id, openedIn },
    ],
  }));
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
 * The tabs the app closed on its own since the session was last told,
 * taken from the chat's state: whoever reads them tells it. The chat's own
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
 * first: who is at work in it. Free while nothing has driven the tab.
 */
export function workingIn(targetId: BrowserTargetId) {
  return actsIn(targetId).filter((act) => isWorkingNow(act));
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
    const holder = actsIn(tab.targetId)
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
function isWorkingNow({
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
