import { type ChatId } from "../../../schemas/chat-id";
import { StoreId } from "../../../schemas/store-id";
import { WINDOW_ID } from "../../../schemas/window-id";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
} from "../../../types";
import { tabHolders } from "../../chat/window-tab";
import { TASK_COMMAND } from "../task-command";
import { isLocalAddress } from "../../local-page-address";
import { getWorkspaceConfig } from "../../workspace-config";

/**
 * A tab id from the note on the user's message is the session half of one of
 * the chat's own browser targets; the target has to exist, since the
 * task connects to it rather than creating anything. A tab showing a file on
 * the computer is not handed over: its address is a path only the window
 * opens, and a task reaches a file through its folders, never through a
 * browser standing on one.
 */
async function resolveTab(tab: string): Promise<BrowserTargetId> {
  // The window's tabs are the window's, whichever chat names one.
  const windowId = WINDOW_ID;
  const sessionId = StoreId.SessionSchema.safeParse(tab);
  if (!sessionId.success) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
    );
  }
  const targetId = encodeBrowserTargetId(windowId, sessionId.data);
  const { browser } = getWorkspaceConfig();
  if (!browser.getTargetMeta(targetId)) {
    throw new Error(`Tab ${tab} is not open any more.`);
  }
  const targets = await browser.listTargets(windowId);
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
  { closedIsFine = false }: { closedIsFine?: boolean } = {},
): Promise<BrowserTargetId[]> {
  const resolved: BrowserTargetId[] = [];
  for (const tab of tabs) {
    const id = closedIsFine ? await tabTargetOf(tab) : await resolveTab(tab);
    if (!resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
}

/** A tab id in the window's terms, open or not. */
async function tabTargetOf(tab: string): Promise<BrowserTargetId> {
  const sessionId = StoreId.SessionSchema.safeParse(tab);
  if (!sessionId.success) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
    );
  }
  return encodeBrowserTargetId(WINDOW_ID, sessionId.data);
}

/** The id a tab goes by in the note and on `--tab`. */
function tabIdOf(targetId: BrowserTargetId): string {
  return decodeBrowserTargetId(targetId)?.sessionId ?? targetId;
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
    const holder = holders.get(tabIdOf(id));
    return holder ? [`${tabIdOf(id)} (${holder.id}, "${holder.title}")`] : [];
  });
  if (driven.length > 0) {
    throw new Error(
      `--tab ${driven.join(", ")}: another task is working in ${driven.length === 1 ? "that tab" : "those tabs"}, and a tab has one driver at a time. Ask that task with \`${TASK_COMMAND.name} send\` instead, or wait for it to finish: its tabs come back to you then.`,
    );
  }
}

/** What a hand-over prints about the tabs it made, or nothing. */
export function handedTabsLine(tabs: BrowserTargetId[]): string {
  return tabs.length > 0
    ? `Its tabs: ${tabs.map((id) => tabIdOf(id)).join(", ")}.\n`
    : "";
}
