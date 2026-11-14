import { type BrowserTargetId } from "../../types";
import { type ChatId } from "../../schemas/chat-id";
import { usedThisTurn } from "../tab-activity";
import { workingIn } from "./chat-tabs";

/**
 * Whether an agent with a turn running right now has driven the tab: any
 * session of any chat, since every session of a chat drives every tab of it.
 * Only tabs an agent sent commands are read, so it costs nothing while none
 * has.
 */
export function isDrivenByWorkingAgent(
  targetId: BrowserTargetId,
): Promise<boolean> {
  return Promise.resolve(workingIn(targetId).length > 0);
}

/**
 * The chat whose agent is at work with the tab: a session with a turn
 * running that sent the tab a command in that turn, the latest first. Every
 * page a turn used keeps it until the turn ends, since the agent may go
 * back to any of them; a page used only in an earlier turn has none.
 */
export function chatWorkingIn(targetId: BrowserTargetId): ChatId | undefined {
  return workingIn(targetId).find(({ sessionId }) =>
    usedThisTurn(targetId, sessionId),
  )?.chatId;
}
