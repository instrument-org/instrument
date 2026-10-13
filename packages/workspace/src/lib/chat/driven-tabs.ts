import { type BrowserTargetId } from "../../types";
import { getChatState } from "../chat-record";
import { chatDir, sessionOfChat } from "../record-folders";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { isWorking } from "./activity";

/**
 * Whether an agent with a turn running right now drives the tab: the task a
 * chat handed it to, or the chat's own conversation for a tab no task
 * drives. Only chats with a running session are read, so it costs nothing
 * while every agent is idle.
 */
export async function isDrivenByWorkingAgent(
  targetId: BrowserTargetId,
): Promise<boolean> {
  const { sessionRefsByChatId } = getWorkspaceActorRef().getSnapshot().context;
  for (const chatId of sessionRefsByChatId.keys()) {
    const held = (await getChatState(chatDir(chatId))).browserTabs.find(
      (tab) => tab.id === targetId,
    );
    if (held) {
      const driver = held.driver ?? sessionOfChat(chatId);
      return driver !== undefined && isWorking(chatId, driver);
    }
  }
  return false;
}
