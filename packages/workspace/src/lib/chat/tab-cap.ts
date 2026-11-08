import { tabLifetime } from "../../machines/window-browser";
import { type ChatId } from "../../schemas/chat-id";
import {
  CHAT_HIDDEN_TAB_CAP,
  type ClosedTab,
  type OpenedTab,
} from "../../schemas/chat-state";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat, sessionOfChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { type ChatPageTab, chatPageTabs, workingIn } from "./chat-tabs";
import { openAsks } from "./open-asks";
import { askWindow } from "./window-tab";

/**
 * Closes the tabs a chat's agents opened that are out of sight past
 * `CHAT_HIDDEN_TAB_CAP`, the one hidden longest first, and leaves a word for
 * the chat's conversation, which its next browser note says. A tab whose
 * page is unloaded counts as hidden longer than any with a page. A tab the
 * window no longer lists is gone already and is forgotten.
 */
export async function closeTabsOverCap(chatId: ChatId): Promise<void> {
  const { openedTabs } = await getChatState(chatDir(chatId));
  if (openedTabs.length <= CHAT_HIDDEN_TAB_CAP) {
    return;
  }
  const listed = await chatPageTabs(chatId);
  const hidden = openedTabs
    .filter((tab) => listed?.some((entry) => entry.id === tab.id) ?? true)
    .map((tab) => ({ life: tabLifetime(tab.id), tab }))
    .filter(({ life }) => life?.drawn !== true)
    .toSorted(
      (a, b) =>
        (b.life?.hiddenForMs ?? Number.POSITIVE_INFINITY) -
        (a.life?.hiddenForMs ?? Number.POSITIVE_INFINITY),
    );
  const over = hidden
    .slice(0, Math.max(0, hidden.length - CHAT_HIDDEN_TAB_CAP))
    .map(({ tab }) => tab);
  await closeOpened(chatId, over, listed, "tabCap");
}

/**
 * Closes the tabs the chat's agents opened that nobody is working in and the
 * person never used, as the chat's own turn ends, so the pane is back to the
 * person's own. A tab they clicked or typed in, one on screen now, one the
 * chat waits on them in, and one a task with a turn running has driven
 * stay. A task's tabs are left open when its turn ends, for the chat its
 * finish wakes to show or close. The chat's next browser note names each
 * closed tab and where it was, and the agent opens the address again if the
 * work still needs it.
 */
export async function closeTurnTabs(chatId: ChatId): Promise<void> {
  const { openedTabs } = await getChatState(chatDir(chatId));
  if (openedTabs.length === 0) {
    return;
  }
  const { browser } = getWorkspaceConfig();
  const waitedOn = new Set(
    (await openAsks(chatId)).flatMap((ask) =>
      ask.kind === "page" ? [ask.target] : [],
    ),
  );
  const listed = await chatPageTabs(chatId);
  // The turn ending is the chat's own, however its session reads this moment.
  const own = sessionOfChat(chatId);
  const unused = openedTabs.filter(
    (tab) =>
      !waitedOn.has(tab.id) &&
      tabLifetime(tab.id)?.drawn !== true &&
      browser.personInputAt(tab.id) === undefined &&
      !workingIn(tab.id).some((act) => act.sessionId !== own),
  );
  await closeOpened(chatId, unused, listed, "turnEnd");
}

/** Closes tabs the chat's agents opened, telling the chat's conversation, and forgets those already gone. */
async function closeOpened(
  chatId: ChatId,
  tabs: readonly OpenedTab[],
  listed: ChatPageTab[] | undefined,
  reason: ClosedTab["reason"],
): Promise<void> {
  // A tab the person closed already has nothing left to close.
  const open = tabs.filter(
    (tab) => listed?.some((entry) => entry.id === tab.id) ?? true,
  );
  const gone = listed
    ? (await getChatState(chatDir(chatId))).openedTabs.filter(
        (tab) => !listed.some((entry) => entry.id === tab.id),
      )
    : [];
  if (open.length === 0 && gone.length === 0) {
    return;
  }
  const closing = await Promise.all(
    open.map((tab) => closedTab(tab, listed, reason)),
  );
  const ids = new Set([...open, ...gone].map((tab) => tab.id));
  await updateChatState(chatDir(chatId), (state) => ({
    closedTabs: [...state.closedTabs, ...closing],
    openedTabs: state.openedTabs.filter((tab) => !ids.has(tab.id)),
  }));
  for (const tab of open) {
    await askWindow({
      action: { kind: "close", tabId: tab.id },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
  }
}

/**
 * What the chat is told of a tab it closes: where it was, from its page, or
 * from the window's list for a tab whose page was unloaded.
 */
async function closedTab(
  tab: OpenedTab,
  listed: ChatPageTab[] | undefined,
  reason: ClosedTab["reason"],
): Promise<ClosedTab> {
  const { browser } = getWorkspaceConfig();
  const live = browser.getTargetUrl(tab.id);
  const kept =
    live === undefined
      ? listed?.find((entry) => entry.id === tab.id)
      : undefined;
  const title =
    (await browser.listTargets()).find((target) => target.id === tab.id)
      ?.title ?? kept?.title;
  return {
    id: tab.id,
    reason,
    ...(title ? { title } : {}),
    url: live ?? kept?.url ?? "",
  };
}
