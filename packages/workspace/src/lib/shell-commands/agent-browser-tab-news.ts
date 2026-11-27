import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { isExtensionPage } from "../../logic/server/routes/cdp-bridge";
import { closedTabsModelText } from "../../model-text/notes/browser-status-model-text";
import { listChildTasks } from "../chat/children";
import { agentTabIdOf, chatPageTabs, takeClosedTabs } from "../chat/chat-tabs";
import { agentSpellingOfFileUrls } from "../local-page-address";
import { sessionLayout } from "../session-layout";
import { sessionOfChat } from "../record-folders";
import { type TabNews, takePopups, takeTabNews } from "../tab-activity";

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
  const [tasks, tabs] = await Promise.all([
    listChildTasks(chatId),
    chatPageTabs(chatId),
  ]);
  const handles = new Map(tasks.map((task) => [task.id, task.handle]));
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
    return `Tab ${agentTabIdOf(tabs, tab.targetId)} was used since your last command in it, by ${who.join(" and ")}.`;
  });
  return `${lines.join("\n")}\nThe chat and its tasks share every tab: check the page before relying on what you last saw there. Going to another page in this tab undoes their work on it: work that needs this page itself waits for them or asks, and work that needs only the site goes in a tab of your own (\`agent-browser tab new <url>\`).\n`;
}

function ago(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : `${Math.round(seconds / 60)} min ago`;
}

/**
 * The line a result ends with when a page it drove opened a popup
 * (`window.open`), which the app opened as a tab of the chat behind
 * whatever is up: the tab's id, which `agent-browser tab <id>` switches to.
 * The tab was kept as one the session opened as it opened (`notePageOpenedTab`).
 */
export async function pageOpenedTabsNote({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const opened = takePopups(sessionId);
  if (opened.length === 0) {
    return undefined;
  }
  const tabs = await chatPageTabs(chatId);
  return `${opened
    .map(({ from, ...tab }) => ({ ...tab, from: agentTabIdOf(tabs, from) }))
    .map((tab) =>
      isExtensionPage(tab.url)
        ? `The page in tab ${tab.from} had a browser extension open ${tab.url}, the extension's own page, as a new tab of this chat, ${tab.tabId}. It is the user's to use.`
        : `The page in tab ${tab.from} opened ${tab.url} as a popup, which is a new tab of this chat, ${tab.tabId}: \`agent-browser tab ${tab.tabId}\` switches to it.`,
    )
    .join("\n")}\n`;
}

/**
 * The line a result ends with when the app closed tabs this session worked
 * in since it was last told, as the hidden-tab cap does when another tab
 * opens: taken, so the next message's browser note does not say it again.
 */
export async function closedTabsNote({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const closed = await takeClosedTabs(chatId, sessionId);
  if (closed.length === 0) {
    return undefined;
  }
  const layout = await sessionLayout({ chatId, sessionId });
  return `${closedTabsModelText(
    closed.map(({ id, reason, title, url }) => ({
      id,
      reason,
      ...(title ? { title } : {}),
      url: agentSpellingOfFileUrls(url, layout),
    })),
  )}\n`;
}
