import { type ChatId } from "../../../schemas/chat-id";
import { type WindowTabAnswer } from "../../../schemas/window-tab";
import { type BrowserTargetId, parseBrowserTargetId } from "../../../types";
import { askWindow, tabHolders } from "../../chat/window-tab";
import { resolveChat } from "../../record-folders";
import { TASK_COMMAND } from "../../shell-commands/task-command";
import { WINDOW_COMMAND } from "../../shell-commands/window-command";
import { isLocalAddress } from "../../local-page-address";

type ChatTab = NonNullable<WindowTabAnswer["tabs"]>[number];

/**
 * A tab id from the note on the user's message names one of the chat's own
 * tabs, as the window holds them at this moment: a tab in no chat or in
 * another is never the chat's to hand over, whatever id it was given. Only a
 * page goes to a task, and one whose page was let go goes as well, since the
 * task brings it back before it works in it. A tab showing a file on the
 * computer is not handed over: its address is a path only the window opens,
 * and a task reaches a file through its folders, never through a browser
 * standing on one.
 */
function resolveTab(
  tab: string,
  chatTabs: readonly ChatTab[],
): BrowserTargetId {
  const listed = chatTabs.find((entry) => entry.id === tab);
  if (!listed) {
    throw new Error(notTheChatsTab(tab, chatTabs));
  }
  const targetId = parseBrowserTargetId(tab);
  if (listed.kind !== "page" || targetId === null) {
    throw new Error(
      `Tab ${tab} shows a screen of the app, not a page; only a page goes to a task.`,
    );
  }
  if (isLocalAddress(listed.url)) {
    throw new Error(
      `Tab ${tab} shows a file on this computer, which a task is not handed; give the task the folder the file is in instead.`,
    );
  }
  return targetId;
}

/**
 * Why a tab id is not one to hand a task, with the chat's own tabs to pick
 * from: agent-browser's `t1` is its label for a tab, a `tab_` id outside the
 * chat is the user's to move in, and anything else is no tab.
 */
function notTheChatsTab(tab: string, chatTabs: readonly ChatTab[]): string {
  const pages = chatTabs.filter((entry) => entry.kind === "page");
  const own =
    pages.length > 0
      ? ` This chat's tabs: ${pages.map((entry) => `${entry.id} ("${entry.title || entry.url}")`).join(", ")}.`
      : " This chat has no tabs yet.";
  const why = /^t\d+$/i.test(tab)
    ? `"${tab}" is agent-browser's label for a tab, not its id.`
    : parseBrowserTargetId(tab) === null
      ? `"${tab}" is not a tab id; tab ids start with tab_.`
      : `Tab ${tab} is not one of this chat's tabs. A tab of the user's that the note on their message named outside this chat comes in with \`${WINDOW_COMMAND.name} request ${tab}\`.`;
  return `${why}${own} \`${WINDOW_COMMAND.name} list\` names them.`;
}

/** Several tab ids, each resolved, without repeats; `closedIsFine` for ids only being let go of. */
export async function resolveTabs(
  tabs: string[],
  { chatId, closedIsFine = false }: { chatId: ChatId; closedIsFine?: boolean },
): Promise<BrowserTargetId[]> {
  const chatTabs =
    closedIsFine || tabs.length === 0 ? [] : await tabsOfChat(chatId);
  const resolved: BrowserTargetId[] = [];
  for (const tab of tabs) {
    const id = closedIsFine
      ? await tabTargetOf(tab)
      : resolveTab(tab, chatTabs);
    if (!resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
}

/** The chat's tabs, as the window holds them now; none when no window answers. */
async function tabsOfChat(chatId: ChatId): Promise<ChatTab[]> {
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: chatId,
    group: resolveChat(chatId),
  });
  return answer?.tabs ?? [];
}

/** A tab id in the window's terms, open or not. */
async function tabTargetOf(tab: string): Promise<BrowserTargetId> {
  const targetId = parseBrowserTargetId(tab);
  if (targetId === null) {
    throw new Error(
      `"${tab}" is not a tab id; tab ids start with tab_, and \`${WINDOW_COMMAND.name} list\` names this chat's.`,
    );
  }
  return targetId;
}

/**
 * Refuses tabs another working task drives: one driver per tab, so two
 * agents never act in one page at once. A tab the chat drives, or one a
 * finished task left, is the new task's to take.
 */
export async function refuseTabsDrivenElsewhere(
  tabs: BrowserTargetId[],
  chatId: ChatId,
): Promise<void> {
  if (tabs.length === 0) {
    return;
  }
  const holders = await tabHolders(chatId);
  const driven = tabs.flatMap((id) => {
    const holder = holders.get(id);
    return holder ? [`${id} (${holder.id}, "${holder.title}")`] : [];
  });
  if (driven.length > 0) {
    throw new Error(
      `--tab ${driven.join(", ")}: another task is working in ${driven.length === 1 ? "that tab" : "those tabs"}, and a tab has one driver at a time. Ask that task with \`${TASK_COMMAND.name} send\` instead, or wait for it to finish: its tabs come back to you then.`,
    );
  }
}

/** What a hand-over prints about the tabs it made, or nothing. */
export function handedTabsLine(tabs: readonly string[]): string {
  return tabs.length > 0 ? `Its tabs: ${tabs.join(", ")}.\n` : "";
}
