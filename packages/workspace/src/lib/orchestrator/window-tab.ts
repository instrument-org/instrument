import { ulid } from "ulid";

import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import {
  type WindowTabAction,
  type WindowTabAnswer,
} from "../../schemas/window-tab";
import { decodeBrowserTargetId } from "../../types";
import { sessionOfChat } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { isWorking } from "./activity";
import { listChildTasks } from "./children";

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
 * `group` is the chat the tab belongs to, by its session.
 */
export async function askWindow({
  action,
  askedBy,
  group,
  timeoutMs = WINDOW_TAB_TIMEOUT_MS,
}: {
  action: WindowTabAction;
  askedBy: TaskId;
  group: StoreId.Session | undefined;
  timeoutMs?: number;
}): Promise<undefined | WindowTabAnswer> {
  const requestId = ulid();
  const controller = new AbortController();
  const answers = publisher.subscribe("orchestrator.tabDone", {
    signal: controller.signal,
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  publisher.publish("orchestrator.tab", {
    action,
    id: askedBy,
    requestId,
    ...(group ? { sessionId: group } : {}),
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
 * The chat a task was started in, by the chat's session: its parent, or its
 * parent's, up to the chat. Undefined for a task no chat owns.
 */
export async function chatSessionOfTask(
  taskId: TaskId,
): Promise<StoreId.Session | undefined> {
  const seen = new Set<TaskId>();
  let current: TaskId | undefined = taskId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const session = sessionOfChat(current);
    if (session) {
      return session;
    }
    const settings = await getTaskSettings(taskDir(current));
    current = settings?.parentTaskId;
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
  askedBy: TaskId;
  group: StoreId.Session | undefined;
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
  chatId: TaskId,
): Promise<Map<string, { id: TaskId; title: string }>> {
  const holders = new Map<string, { id: TaskId; title: string }>();
  for (const task of await listChildTasks(chatId)) {
    if (!isWorking(task.id)) {
      continue;
    }
    const state = await getTaskState(taskDir(task.id));
    for (const held of state.browserTabs ?? []) {
      const decoded = decodeBrowserTargetId(held.id);
      if (decoded) {
        holders.set(decoded.sessionId, { id: task.id, title: task.title });
      }
    }
  }
  return holders;
}
