import { tabLifetime } from "../../machines/window-browser";
import { type ChatId } from "../../schemas/chat-id";
import {
  CHAT_HIDDEN_TAB_CAP,
  type ClosedTab,
  type HeldTab,
} from "../../schemas/chat-state";
import { type WindowTabAnswer } from "../../schemas/window-tab";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { askWindow } from "./window-tab";

type ListedTab = NonNullable<WindowTabAnswer["tabs"]>[number];

/**
 * Closes the tabs a chat's agents opened that are out of sight past
 * `CHAT_HIDDEN_TAB_CAP`, the one hidden longest first, and leaves a word for
 * the session that drove each, which its next browser note says. A tab
 * whose page is unloaded counts as hidden longer than any with a page.
 *
 * The window says which tabs are open: a tab the person closed stays in its
 * session's `browserTabs` until that session next browses, which is how it
 * learns its pages are gone (`refuseBrowserFor`), and is no tab to count or
 * close. With no window to ask, the records are all there is.
 */
export async function closeTabsOverCap(chatId: ChatId): Promise<void> {
  const { browserTabs } = await getChatState(chatDir(chatId));
  const counted = browserTabs.filter(
    (tab) => tab.openedBy === "task" && tab.inWindow,
  );
  if (counted.length <= CHAT_HIDDEN_TAB_CAP) {
    return;
  }
  const listed = (
    await askWindow({
      action: { kind: "list" },
      askedBy: chatId,
      group: resolveChat(chatId),
    })
  )?.tabs;
  const hidden = counted
    .filter((tab) => listed?.some((entry) => entry.id === tab.id) ?? true)
    .map((tab) => ({ life: tabLifetime(tab.id), tab }))
    .filter(({ life }) => life?.drawn !== true)
    .toSorted(
      (a, b) =>
        (b.life?.hiddenForMs ?? Number.POSITIVE_INFINITY) -
        (a.life?.hiddenForMs ?? Number.POSITIVE_INFINITY),
    );
  const over = hidden.slice(
    0,
    Math.max(0, hidden.length - CHAT_HIDDEN_TAB_CAP),
  );
  if (over.length === 0) {
    return;
  }
  const closing = await Promise.all(
    over.map(({ tab }) => closedTab(tab, listed)),
  );
  const ids = new Set(closing.map((tab) => tab.id));
  await updateChatState(chatDir(chatId), (state) => ({
    browserTabs: state.browserTabs.filter((tab) => !ids.has(tab.id)),
    closedTabs: [...state.closedTabs, ...closing],
  }));
  for (const { tab } of over) {
    await askWindow({
      action: { kind: "close", tabId: tab.id },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
  }
}

/**
 * What the session that drove a tab is told of it: where it was, from its
 * page, or from the window's list for a tab whose page was unloaded.
 */
async function closedTab(
  tab: HeldTab,
  listed: ListedTab[] | undefined,
): Promise<ClosedTab> {
  const { browser } = getWorkspaceConfig();
  const live = browser.getTargetUrl(tab.id);
  const kept =
    live === undefined
      ? listed?.find((entry) => entry.id === tab.id)
      : undefined;
  const title =
    (await browser.listTargets()).find((target) => target.id === tab.id)
      ?.title ?? (kept?.kind === "page" ? kept.title : undefined);
  return {
    ...(tab.driver ? { driver: tab.driver } : {}),
    id: tab.id,
    reason: "tabCap",
    ...(title ? { title } : {}),
    url: live ?? (kept?.kind === "page" ? kept.url : ""),
  };
}
