import { type BrowserTargetId } from "../../types";
import { type ChatId } from "../../schemas/chat-id";
import {
  latestTurnTabs,
  pageOfTab,
  tabOfPage,
  usedThisTurn,
} from "../tab-activity";
import { isWorkingNow, workingIn } from "./chat-tabs";

/**
 * Whether an agent with a turn running right now has driven the tab a page
 * draws: any session of any chat, since every session of a chat drives
 * every tab of it. Only tabs an agent sent commands are read, so it costs
 * nothing while none has.
 */
export function isDrivenByWorkingAgent(
  targetId: BrowserTargetId,
): Promise<boolean> {
  return Promise.resolve(workingIn(tabOfPage(targetId)).length > 0);
}

/**
 * The chat whose agent is at work with the tab a page draws: a session with
 * a turn running that sent the tab a command in that turn, the latest
 * first. Every tab a turn used keeps it until the turn ends, since the
 * agent may go back to any of them; a tab used only in an earlier turn has
 * none.
 */
export function chatWorkingIn(targetId: BrowserTargetId): ChatId | undefined {
  const tabId = tabOfPage(targetId);
  return workingIn(tabId).find(({ sessionId }) =>
    usedThisTurn(tabId, sessionId),
  )?.chatId;
}

/** A tab an agent is on now, by the page drawing it, and the chat whose agent it is. */
export interface TabInUse {
  chatId: ChatId;
  targetId: BrowserTargetId;
}

/**
 * The tab each session with a turn running is on: the one it sent its latest
 * command of that turn. Narrower than `chatWorkingIn`, which keeps every page
 * the turn used: closing a page stops its agent, so a page the agent has left
 * for another closes without stopping it.
 */
export function tabsInUse(): TabInUse[] {
  return latestTurnTabs()
    .filter((act) => isWorkingNow(act))
    .flatMap(({ chatId, tabId }) => {
      const targetId = pageOfTab(tabId);
      return targetId === undefined ? [] : [{ chatId, targetId }];
    });
}
