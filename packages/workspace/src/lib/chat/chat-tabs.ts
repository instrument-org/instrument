import { type ChatId } from "../../schemas/chat-id";
import { type ClosedTab } from "../../schemas/chat-state";
import { type WindowTabAnswer } from "../../schemas/window-tab";
import { type BrowserTargetId, parseBrowserTargetId } from "../../types";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat } from "../record-folders";
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

/** Keeps a tab an agent of the chat opened, which closes once nobody is working in it (`closeTurnTabs`). */
export async function noteOpenedTab(
  chatId: ChatId,
  id: BrowserTargetId,
): Promise<void> {
  await updateChatState(chatDir(chatId), ({ openedTabs }) => ({
    openedTabs: [...openedTabs.filter((tab) => tab.id !== id), { id }],
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
 * The tabs the app closed on its own since the chat's conversation was last
 * told, taken from the chat's state: whoever reads them tells it.
 */
export async function takeClosedTabs(chatId: ChatId): Promise<ClosedTab[]> {
  const { closedTabs } = await getChatState(chatDir(chatId));
  if (closedTabs.length === 0) {
    return [];
  }
  let taken: ClosedTab[] = [];
  await updateChatState(chatDir(chatId), (state) => {
    taken = state.closedTabs;
    return { closedTabs: [] };
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

/**
 * The tasks of a chat at work in each of its tabs, by the tab's id, the one
 * that acted last when several are: what lets the conversation see who is
 * using a page before it closes or replaces it.
 */
export async function tabHolders(
  chatId: ChatId,
): Promise<Map<string, { id: string; title: string }>> {
  const holders = new Map<string, { id: string; title: string }>();
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
      holders.set(tab.id, { id: holder.handle, title: holder.title });
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
