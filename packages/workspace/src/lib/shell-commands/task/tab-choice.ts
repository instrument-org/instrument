import { type ChatId } from "../../../schemas/chat-id";
import { type BrowserTargetId, parseBrowserTargetId } from "../../../types";
import { askWindow, tabHolders } from "../../chat/window-tab";
import { resolveChat } from "../../record-folders";
import { TASK_COMMAND } from "../task-command";
import { isLocalAddress } from "../../local-page-address";
import { getWorkspaceConfig } from "../../workspace-config";

/**
 * A tab id from the note on the user's message names one of the chat's own
 * tabs, as the window holds them at this moment: a tab in no chat or in
 * another is never the chat's to hand over, whatever id it was given. The
 * target has to exist, since the task connects to it rather than creating
 * anything. A tab showing a file on the computer is not handed over: its
 * address is a path only the window opens, and a task reaches a file
 * through its folders, never through a browser standing on one.
 */
async function resolveTab(
  tab: string,
  chatTabs: readonly string[],
): Promise<BrowserTargetId> {
  const targetId = await tabTargetOf(tab);
  if (!chatTabs.includes(targetId)) {
    throw new Error(
      `Tab ${tab} is not one of this chat's tabs; the note on the user's message lists the ones it has.`,
    );
  }
  const { browser } = getWorkspaceConfig();
  if (!browser.getTargetMeta(targetId)) {
    throw new Error(`Tab ${tab} is not open any more.`);
  }
  const targets = await browser.listTargets();
  const target = targets.find((candidate) => candidate.id === targetId);
  if (target && isLocalAddress(target.url)) {
    throw new Error(
      `Tab ${tab} shows a file on this computer, which a task is not handed; give the task the folder the file is in instead.`,
    );
  }
  return targetId;
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
      : await resolveTab(tab, chatTabs);
    if (!resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
}

/** The ids of the chat's tabs, as the window holds them now; none when no window answers. */
async function tabsOfChat(chatId: ChatId): Promise<string[]> {
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: chatId,
    group: resolveChat(chatId),
  });
  return answer?.tabIds ?? [];
}

/** A tab id in the window's terms, open or not. */
async function tabTargetOf(tab: string): Promise<BrowserTargetId> {
  const targetId = parseBrowserTargetId(tab);
  if (targetId === null) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
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
export function handedTabsLine(tabs: BrowserTargetId[]): string {
  return tabs.length > 0 ? `Its tabs: ${tabs.join(", ")}.\n` : "";
}
