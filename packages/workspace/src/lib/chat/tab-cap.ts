import { tabLifetime } from "../../machines/window-browser";
import { type ChatId } from "../../schemas/chat-id";
import {
  CHAT_HIDDEN_TAB_CAP,
  type ClosedTab,
  type OpenedTab,
} from "../../schemas/chat-state";
import { type StoreId } from "../../schemas/store-id";
import { getChatState, updateChatState } from "../chat-record";
import { chatDir, resolveChat, sessionOfChat } from "../record-folders";
import { actsIn, forgetTab, lastActOf } from "../tab-activity";
import { getWorkspaceConfig } from "../workspace-config";
import { type ChatPageTab, chatPageTabs, workingIn } from "./chat-tabs";
import { type ChatTask, listChildTasks } from "./children";
import { openAsks } from "./open-asks";
import { askWindow } from "./window-tab";

/**
 * Closes the tabs a chat's agents opened that are out of sight past
 * `CHAT_HIDDEN_TAB_CAP`, the one hidden longest first, and leaves a word for
 * the session that worked in each, which its next browser note says. Only
 * tabs the person never used count and close: one they used is theirs to
 * keep, and never makes room for itself by closing the tab an agent just
 * opened. A tab whose page is unloaded counts as hidden longer than any
 * with a page. A tab the window no longer lists is gone already and is
 * forgotten.
 */
export async function closeTabsOverCap(chatId: ChatId): Promise<void> {
  await inTurn(chatId, async () => {
    const { openedTabs } = await getChatState(chatDir(chatId));
    if (openedTabs.length <= CHAT_HIDDEN_TAB_CAP) {
      return;
    }
    const listed = await chatPageTabs(chatId);
    const hidden = openedTabs
      .filter((tab) => listed?.some((entry) => entry.id === tab.id) ?? true)
      .map((tab) => ({ life: tabLifetime(tab.id), tab }))
      .filter(({ tab }) => isUnused(tab))
      .toSorted(
        (a, b) =>
          (b.life?.hiddenForMs ?? Number.POSITIVE_INFINITY) -
          (a.life?.hiddenForMs ?? Number.POSITIVE_INFINITY),
      );
    const over = hidden
      .slice(0, Math.max(0, hidden.length - CHAT_HIDDEN_TAB_CAP))
      .map(({ tab }) => tab);
    await closeOpened(chatId, over, listed, "tabCap");
  });
}

/**
 * Closes the tabs the chat's agents opened that nobody can still be working
 * in and the person never used, as the chat's own turn ends, so the pane is
 * back to the person's own. A tab they used (`usedByPerson`), one on
 * screen now, one the chat waits on them in, one a task with a turn running has
 * driven, and one a task opened or worked in that can still be sent on
 * (`task send`) stay; a task's tabs close when it is stopped
 * (`closeTaskTabs`). The next browser note of the session that worked in
 * each closed tab names it and where it was, and the agent opens the
 * address again if the work still needs it.
 */
export async function closeTurnTabs(chatId: ChatId): Promise<void> {
  await inTurn(chatId, async () => {
    const { openedTabs } = await getChatState(chatDir(chatId));
    if (openedTabs.length === 0) {
      return;
    }
    const waitedOn = new Set(
      (await openAsks(chatId)).flatMap((ask) =>
        ask.kind === "page" ? [ask.target] : [],
      ),
    );
    const tasks = await listChildTasks(chatId);
    const listed = await chatPageTabs(chatId);
    // The turn ending is the chat's own, however its session reads this moment.
    const own = sessionOfChat(chatId);
    const unused = openedTabs.filter(
      (tab) =>
        !waitedOn.has(tab.id) &&
        isUnused(tab) &&
        !workingIn(tab.id).some((act) => act.sessionId !== own) &&
        !tasks.some((task) => !task.stoppedBy && isTasks(tab, task)),
    );
    await closeOpened(chatId, unused, listed, "turnEnd");
  });
}

/**
 * Closes the tabs a task opened or worked in as the task is stopped, which
 * nothing sends on: those the person never used, that are not on screen,
 * and that no other task that can still be sent on holds.
 */
export async function closeTaskTabs(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<void> {
  await inTurn(chatId, async () => {
    const { openedTabs } = await getChatState(chatDir(chatId));
    const tasks = (await listChildTasks(chatId)).filter(
      (task) => task.id !== sessionId && !task.stoppedBy,
    );
    const theirs = openedTabs.filter(
      (tab) =>
        (tab.openedIn === sessionId ||
          lastActOf(tab.id, sessionId) !== undefined) &&
        isUnused(tab) &&
        !tasks.some((task) => isTasks(tab, task)),
    );
    if (theirs.length === 0) {
      return;
    }
    await closeOpened(chatId, theirs, await chatPageTabs(chatId), "turnEnd");
  });
}

/**
 * Closes the tabs the chat's agents opened as the chat is archived, those
 * the person never used, or put in the trash, every one, since the chat is
 * gone; telling nobody: no session of it works on.
 */
export async function closeChatTabs(
  chatId: ChatId,
  { trashed }: { trashed: boolean },
): Promise<void> {
  await inTurn(chatId, async () => {
    const { openedTabs } = await getChatState(chatDir(chatId));
    const closing = trashed
      ? openedTabs
      : openedTabs.filter((tab) => isUnused(tab));
    if (closing.length === 0) {
      return;
    }
    const ids = new Set(closing.map((tab) => tab.id));
    await updateChatState(chatDir(chatId), (state) => ({
      openedTabs: state.openedTabs.filter((tab) => !ids.has(tab.id)),
    }));
    for (const tab of closing) {
      forgetTab(tab.id);
      await askWindow({
        action: { kind: "close", tabId: tab.id },
        askedBy: chatId,
        group: resolveChat(chatId),
      });
    }
  });
}

/** Whether a tab is one the person never used, and not on screen. */
function isUnused(tab: OpenedTab): boolean {
  return tab.usedByPerson !== true && tabLifetime(tab.id)?.drawn !== true;
}

/** Whether a task opened a tab or worked in it. */
function isTasks(tab: OpenedTab, task: ChatTask): boolean {
  return tab.openedIn === task.id || lastActOf(tab.id, task.id) !== undefined;
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
 * each, and forgets those already gone. A tab another close took meanwhile
 * is left to it.
 */
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
  const notes = await Promise.all(
    open.map((tab) => closedTab(chatId, tab, listed, reason)),
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
        ...notes.filter((note) => still.has(note.id) && !told.has(note.id)),
      ],
      openedTabs: state.openedTabs.filter((tab) => !ids.has(tab.id)),
    };
  });
  for (const tab of gone) {
    forgetTab(tab.id);
  }
  for (const tab of closing) {
    forgetTab(tab.id);
    await askWindow({
      action: { kind: "close", tabId: tab.id },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
  }
}

/**
 * What the session that worked in a tab last (else the one that opened it,
 * else the chat) is told of it: where it was, from its page, or from the
 * window's list for a tab whose page was unloaded.
 */
async function closedTab(
  chatId: ChatId,
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
  const own = sessionOfChat(chatId);
  const session =
    actsIn(tab.id).find((act) => act.chatId === chatId)?.sessionId ??
    tab.openedIn;
  return {
    id: tab.id,
    reason,
    ...(session !== undefined && session !== own ? { session } : {}),
    ...(title ? { title } : {}),
    url: live ?? kept?.url ?? "",
  };
}
