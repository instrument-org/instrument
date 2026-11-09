import { ulid } from "ulid";

import { getWorkspaceConfig } from "../workspace-config";
import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabAnswer,
} from "../../schemas/window-tab";
import { type ChatId } from "../../schemas/chat-id";

/**
 * How long an ask waits for the window's answer. The window answers in
 * milliseconds; the wait is for a conversation with no window on it (an
 * eval), where nothing ever answers.
 */
export const WINDOW_TAB_TIMEOUT_MS: number = 2000;

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
  const window = getWorkspaceConfig().windowForChat?.(group);
  publisher.publish("window.tab", {
    action,
    id: askedBy,
    requestId,
    ...(group ? { chatId: group } : {}),
    ...(window === undefined ? {} : { window }),
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
}): Promise<StoreId.Tab | undefined> {
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
  const tabId = StoreId.TabSchema.safeParse(answer?.tabId);
  return tabId.success ? tabId.data : undefined;
}
