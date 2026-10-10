import { ulid } from "ulid";

import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { type HeldTab } from "../../schemas/chat-state";
import {
  type WindowTabAction,
  type WindowTabAnswer,
} from "../../schemas/window-tab";
import { decodeBrowserTargetId } from "../../types";
import { resolveChat, chatDir } from "../record-folders";
import { getBrowserSessionDir } from "../task-dir-utils";
import { getChatState } from "../chat-record";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking } from "./activity";
import { listChildTasks } from "./children";
import { type ChatId } from "../../schemas/chat-id";

/**
 * How long an ask waits for the window's answer. The window answers in
 * milliseconds; the wait is for a conversation with no window on it (an
 * eval), where nothing ever answers.
 */
export const WINDOW_TAB_TIMEOUT_MS = 2000;

/**
 * Asks the window to act on its tabs and waits for its answer, or for the
 * wait to run out, which answers undefined: no window is there to ask. The
 * answer is listened for before the ask goes out, so a window that answers at
 * once is not missed.
 *
 * `group` is the chat the tab belongs to.
 */
export async function askWindow({
  action,
  askedBy,
  group,
  timeoutMs = WINDOW_TAB_TIMEOUT_MS,
}: {
  action: WindowTabAction;
  askedBy: ChatId;
  group: ChatId | undefined;
  timeoutMs?: number;
}): Promise<undefined | WindowTabAnswer> {
  const requestId = ulid();
  const controller = new AbortController();
  const answers = publisher.subscribe("window.tabDone", {
    signal: controller.signal,
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  publisher.publish("window.tab", {
    action,
    id: askedBy,
    requestId,
    ...(group ? { chatId: group } : {}),
  });
  try {
    for await (const answer of answers) {
      if (answer.requestId === requestId) {
        return answer;
      }
    }
  } catch {
    // The wait ran out: no window answered.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return undefined;
}

/**
 * The tabs a task holds with a live guest, after asking the window to bring
 * back any that are still in its list but have not been shown since a
 * launch. A tab the window no longer has stays out: it was closed.
 */
export async function liveHeldTabs(
  chatId: ChatId,
  heldTabs: HeldTab[],
): Promise<HeldTab[]> {
  const { browser } = getWorkspaceConfig();
  const live: HeldTab[] = [];
  for (const held of heldTabs) {
    if (browser.getTargetMeta(held.id)) {
      live.push(held);
      continue;
    }
    const decoded = decodeBrowserTargetId(held.id);
    if (!decoded) {
      continue;
    }
    const answer = await askWindow({
      action: { kind: "restore", tabId: decoded.sessionId },
      askedBy: chatId,
      group: resolveChat(chatId),
    });
    if (answer?.tabId === undefined) {
      continue;
    }
    // The window opens the guest; asking here as well waits for it to
    // attach, and asking twice for one tab makes one guest.
    await browser.createTarget(
      decoded.id,
      decoded.sessionId,
      getBrowserSessionDir(),
    );
    live.push(held);
  }
  return live;
}

/**
 * Asks the window for a page tab and returns its id, or undefined when no
 * window answered. `show` puts the tab on screen; without it the tab joins
 * the chat's list behind whatever is up, which is how every tab an agent
 * opens for its own work arrives.
 */
export async function requestWindowTab({
  askedBy,
  group,
  show,
  timeoutMs,
  url,
}: {
  askedBy: ChatId;
  group: ChatId | undefined;
  show: boolean;
  timeoutMs?: number;
  url?: string;
}): Promise<StoreId.Session | undefined> {
  const answer = await askWindow({
    action: {
      kind: "open",
      show,
      target: { kind: "page", ...(url ? { url } : {}) },
    },
    askedBy,
    group,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const tabId = StoreId.SessionSchema.safeParse(answer?.tabId);
  return tabId.success ? tabId.data : undefined;
}

/**
 * The tasks of a chat at work in each of its tabs, by the tab's id: what
 * lets the conversation see whose page a tab is before it closes or replaces
 * it. A task that has finished holds nothing here.
 */
export async function tabHolders(
  chatId: ChatId,
): Promise<Map<string, { id: string; title: string }>> {
  const holders = new Map<string, { id: string; title: string }>();
  const working = await listChildTasks(chatId, (id) =>
    isWorkingNow(chatId, id),
  );
  if (working.length === 0) {
    return holders;
  }
  const { browserTabs } = await getChatState(chatDir(chatId));
  for (const task of working) {
    for (const held of browserTabs) {
      const decoded = decodeBrowserTargetId(held.id);
      if (decoded && held.driver === task.id) {
        // By its handle, which is what the conversation steers it by.
        holders.set(decoded.sessionId, { id: task.handle, title: task.title });
      }
    }
  }
  return holders;
}

/** Whether a task is working, or false where no workspace is running to ask. */
function isWorkingNow(chatId: ChatId, sessionId: StoreId.Session): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
