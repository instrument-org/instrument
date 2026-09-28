import { ulid } from "ulid";

import { publisher } from "../../rpc/publisher";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { sessionOfChat } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";

/**
 * How long a page waits for the window to name the tab it made. The window
 * answers in milliseconds; the wait is for a conversation with no window on
 * it (an eval), where nothing ever answers.
 */
export const WINDOW_TAB_TIMEOUT_MS = 2000;

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
 * Asks the window for a page tab and waits for the tab's id, or for the wait
 * to run out. The answer is listened for before the ask goes out, so a window
 * that answers at once is not missed.
 *
 * `group` is the chat the tab belongs to, by its session. `show` puts the tab
 * on screen; without it the tab joins the chat's list behind whatever is up,
 * which is how every tab an agent opens for its own work arrives.
 */
export async function requestWindowTab({
  askedBy,
  group,
  show,
  timeoutMs = WINDOW_TAB_TIMEOUT_MS,
  url,
}: {
  askedBy: TaskId;
  group: StoreId.Session | undefined;
  show: boolean;
  timeoutMs?: number;
  url?: string;
}): Promise<StoreId.Session | undefined> {
  const requestId = ulid();
  const controller = new AbortController();
  const answers = publisher.subscribe("orchestrator.opened", {
    signal: controller.signal,
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  publisher.publish("orchestrator.open", {
    id: askedBy,
    ...(group ? { sessionId: group } : {}),
    target: { kind: "page", requestId, show, ...(url ? { url } : {}) },
  });
  try {
    for await (const answer of answers) {
      if (answer.requestId === requestId) {
        return answer.tabId;
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
