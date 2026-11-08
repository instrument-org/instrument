import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { listChildTasks } from "../chat/children";
import { sessionOfChat } from "../record-folders";
import { type TabNews, takeTabNews } from "../tab-activity";

/**
 * The line an `agent-browser` result ends with when someone else acted in a
 * tab it drove since this session's last command there: another session of
 * the chat, by its handle or as the chat, and the person, each with about
 * when. Nothing when nobody did, which is nearly always.
 */
export async function tabNewsNote({
  chatId,
  now = Date.now(),
  sessionId,
}: {
  chatId: ChatId;
  now?: number;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const news = takeTabNews(sessionId);
  if (news.length === 0) {
    return undefined;
  }
  const handles = new Map(
    (await listChildTasks(chatId)).map((task) => [task.id, task.handle]),
  );
  const chatSession = sessionOfChat(chatId);
  const nameOf = (act: TabNews["agents"][number]) =>
    act.chatId !== chatId
      ? "another chat"
      : act.sessionId === chatSession
        ? "the chat"
        : `task ${handles.get(act.sessionId) ?? "of this chat"}`;
  const lines = news.map((tab) => {
    const who = [
      ...tab.agents.map((act) => `${nameOf(act)} ${ago(now - act.at)}`),
      ...(tab.personAt === undefined
        ? []
        : [`the user ${ago(now - tab.personAt)}`]),
    ];
    return `Tab ${tab.targetId} was used since your last command in it, by ${who.join(" and ")}.`;
  });
  return `${lines.join("\n")}\nThe chat and its tasks share every tab: check the page before relying on what you last saw there, and leave a tab someone else is working in to them, or ask, rather than redo their work.\n`;
}

function ago(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : `${Math.round(seconds / 60)} min ago`;
}
