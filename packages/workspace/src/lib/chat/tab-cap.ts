import { tabLifetime } from "../../machines/window-browser";
import { lastBrowserAgentActivity } from "../browser-agent-activity";
import { type ChatId } from "../../schemas/chat-id";
import {
  CHAT_HIDDEN_TAB_CAP,
  type ClosedTab,
  type OpenedTab,
} from "../../schemas/chat-state";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat, sessionOfChat } from "../record-folders";
import { actsIn, forgetTab, pageOfTab } from "../tab-activity";
import { getWorkspaceConfig } from "../workspace-config";
import { type BrowserTargetId, parseBrowserTargetId } from "../../types";
import {
  type ChatPageTab,
  chatTabs,
  openedTabId,
  pageTabNamed,
} from "./chat-tabs";
import { liveTabTitles, tabPage } from "./tab-page";
import { askWindow } from "./window-tab";

/**
 * Closes the tabs a chat's agents opened that are out of sight past
 * `CHAT_HIDDEN_TAB_CAP`, the one left alone longest first, and leaves a word
 * for the session that worked in each, which its next browser command or
 * message says. A tab is left alone from when it went out of sight or an
 * agent last sent it a command, whichever came later, so a tab an agent is
 * working in behind the chat closes last. Only tabs the person never used
 * count and close: one they used is theirs to keep, and never makes room for
 * itself by closing the tab an agent just opened. A tab whose page is
 * unloaded counts as left alone longer than any with a page. A tab on a
 * file no page draws stays, uncounted and kept, until a page draws it
 * again. A tab the window no longer has is gone already and is forgotten.
 * Tabs are kept by the id agents name them by, which an entry an earlier
 * build kept by its page's id is written as here.
 */
export async function closeTabsOverCap(chatId: ChatId): Promise<void> {
  await inTurn(chatId, async () => {
    const { openedTabs: kept } = await getChatState(chatDir(chatId));
    if (kept.length <= CHAT_HIDDEN_TAB_CAP) {
      return;
    }
    const window = await chatTabs(chatId);
    const listed = window?.pages;
    const openedTabs = await nameOpenedTabs(chatId, kept, listed);
    const hidden = openedTabs
      .filter((tab) => isListed(listed, tab))
      .filter((tab) => isUnused(tab, listed))
      .map((tab) => ({ aloneForMs: aloneForMs(pageOf(listed, tab.id)), tab }))
      .toSorted((a, b) => b.aloneForMs - a.aloneForMs);
    const over = hidden
      .slice(0, Math.max(0, hidden.length - CHAT_HIDDEN_TAB_CAP))
      .map(({ tab }) => tab);
    await closeOpened(chatId, over, window, "tabCap");
  });
}

/**
 * The chat's opened tabs, each by the id agents name it by: an entry an
 * earlier build kept by its page's id is written under the tab's.
 */
async function nameOpenedTabs(
  chatId: ChatId,
  kept: readonly OpenedTab[],
  listed: ChatPageTab[] | undefined,
): Promise<OpenedTab[]> {
  const renamed = new Map(
    kept.flatMap((tab) => {
      const id = parseBrowserTargetId(openedTabId(listed, tab.id));
      return id === null || id === tab.id ? [] : [[tab.id, id] as const];
    }),
  );
  if (renamed.size === 0) {
    return [...kept];
  }
  let named: OpenedTab[] = [];
  await updateChatState(chatDir(chatId), (state) => {
    named = state.openedTabs.map((tab) => {
      const id = renamed.get(tab.id);
      return id === undefined ? tab : { ...tab, id };
    });
    return { openedTabs: named };
  });
  return named;
}

/** The page drawing a tab, by the id agents name the tab by, as the window lists it or a command last named it. */
function pageOf(
  listed: ChatPageTab[] | undefined,
  id: BrowserTargetId,
): BrowserTargetId {
  return pageTabNamed(listed, id)?.targetId ?? pageOfTab(id) ?? id;
}

/**
 * Closes the tabs the chat's agents opened as the chat is archived, those
 * the person never used, or put in the trash, every one, since the chat is
 * gone; telling nobody: no session of it works on. `closed` answers how many
 * close once the chat's state no longer lists them, and `done` settles once
 * the window has been asked to close each.
 */
export function closeChatTabs(
  chatId: ChatId,
  { trashed }: { trashed: boolean },
): { closed: Promise<number>; done: Promise<void> } {
  let count: (closed: number) => void = () => undefined;
  const closed = new Promise<number>((resolve) => {
    count = resolve;
  });
  const done = inTurn(chatId, async () => {
    const { openedTabs } = await getChatState(chatDir(chatId));
    const closing = trashed
      ? openedTabs
      : openedTabs.filter((tab) => isUnused(tab, undefined));
    if (closing.length === 0) {
      count(0);
      return;
    }
    const ids = new Set(closing.map((tab) => tab.id));
    await updateChatState(chatDir(chatId), (state) => ({
      openedTabs: state.openedTabs.filter((tab) => !ids.has(tab.id)),
    }));
    count(closing.length);
    for (const tab of closing) {
      forgetTab(tab.id);
      await askWindow({
        action: { kind: "close", tabId: tab.id },
        askedBy: chatId,
        group: resolveChat(chatId),
      });
    }
  });
  // A close that failed before the state changed closed none.
  void done.catch(() => {
    count(0);
  });
  return { closed, done };
}

/**
 * How long a tab has been out of sight with no agent's command, by the page
 * drawing it, or forever for one whose page is unloaded.
 */
function aloneForMs(id: BrowserTargetId): number {
  const hiddenForMs = tabLifetime(id)?.hiddenForMs ?? Number.POSITIVE_INFINITY;
  const agentAt = lastBrowserAgentActivity(id);
  return agentAt === undefined
    ? hiddenForMs
    : Math.min(hiddenForMs, Date.now() - agentAt);
}

/** Whether a tab is one the person never used, and not on screen. */
function isUnused(tab: OpenedTab, listed: ChatPageTab[] | undefined): boolean {
  return (
    tab.usedByPerson !== true &&
    tabLifetime(pageOf(listed, tab.id))?.drawn !== true
  );
}

/** Each chat's closing in progress, so two never close or note one tab twice. */
const closingByChat = new Map<ChatId, Promise<void>>();

/** Runs a close of a chat's tabs after any already under way for it. */
async function inTurn(chatId: ChatId, close: () => Promise<void>) {
  const before = closingByChat.get(chatId) ?? Promise.resolve();
  const running = before.then(close, close);
  closingByChat.set(chatId, running);
  try {
    await running;
  } finally {
    if (closingByChat.get(chatId) === running) {
      closingByChat.delete(chatId);
    }
  }
}

/**
 * Closes tabs the chat's agents opened, telling the session that worked in
 * each, and forgets those already gone from the window. A tab another close
 * took meanwhile is left to it.
 */
async function closeOpened(
  chatId: ChatId,
  tabs: readonly OpenedTab[],
  window: Awaited<ReturnType<typeof chatTabs>>,
  reason: ClosedTab["reason"],
): Promise<void> {
  const listed = window?.pages;
  // A tab the person closed already has nothing left to close.
  const open = tabs.filter((tab) => isListed(listed, tab));
  const gone = window
    ? (await getChatState(chatDir(chatId))).openedTabs.filter(
        (tab) =>
          !isListed(listed, tab) &&
          !window.standing.has(openedTabId(listed, tab.id)),
      )
    : [];
  if (open.length === 0 && gone.length === 0) {
    return;
  }
  const notes = await Promise.all(
    open.map(async (tab) => ({
      note: await closedTab(chatId, tab, listed, reason),
      tab,
    })),
  );
  const ids = new Set([...open, ...gone].map((tab) => tab.id));
  let closing: OpenedTab[] = [];
  await updateChatState(chatDir(chatId), (state) => {
    const still = new Set<string>(state.openedTabs.map((tab) => tab.id));
    closing = open.filter((tab) => still.has(tab.id));
    const told = new Set(state.closedTabs.map((tab) => tab.id));
    return {
      closedTabs: [
        ...state.closedTabs,
        ...notes
          .filter(({ note, tab }) => still.has(tab.id) && !told.has(note.id))
          .map(({ note }) => note),
      ],
      openedTabs: state.openedTabs.filter((tab) => !ids.has(tab.id)),
    };
  });
  for (const tab of gone) {
    forgetTab(openedTabId(listed, tab.id));
  }
  for (const tab of closing) {
    forgetTab(openedTabId(listed, tab.id));
    await askWindow({
      action: { kind: "close", tabId: openedTabId(listed, tab.id) },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
  }
}

/** Whether the window lists an opened tab among the chat's page tabs, or can't say, with no window to ask. */
function isListed(listed: ChatPageTab[] | undefined, tab: OpenedTab) {
  return listed === undefined || pageTabNamed(listed, tab.id) !== undefined;
}

/**
 * What the session that worked in a tab last (else the one that opened it,
 * else the chat) is told of it, by the id agents name the tab by: where it
 * was, from its page, or from the window's list for a tab whose page was
 * unloaded.
 */
async function closedTab(
  chatId: ChatId,
  tab: OpenedTab,
  listed: ChatPageTab[] | undefined,
  reason: ClosedTab["reason"],
): Promise<ClosedTab> {
  const { browser } = getWorkspaceConfig();
  const id = openedTabId(listed, tab.id);
  const { title, url } = tabPage(browser, pageOf(listed, tab.id), {
    listed: pageTabNamed(listed, tab.id),
    titles: await liveTabTitles(browser),
  });
  const own = sessionOfChat(chatId);
  const session =
    actsIn(id).find((act) => act.chatId === chatId)?.sessionId ?? tab.openedIn;
  return {
    id,
    reason,
    ...(session !== undefined && session !== own ? { session } : {}),
    ...(title ? { title } : {}),
    url: url ?? "",
  };
}
