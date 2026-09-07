import { type TaskId } from "../../schemas/task-id";
import { latestStep } from "./activity";
import { lastAssistantText, latestSessionId } from "./latest-session";
import { Store } from "../store";

/** How much of the agent's own words the list shows on a task's second line. */
const LINE_MAX = 90;

/** Where a task stands, in the three words the list can say it in. */
export type TaskStandingKind = "done" | "running" | "waiting";

export interface TaskStanding {
  kind: TaskStandingKind;
  /**
   * The line under the title: the step while it runs, what it waits for while
   * it waits, and what it made once it is done. Never the word "done" alone.
   */
  line: string;
}

/** What a pending ask is waiting for, in the user's terms. */
const ASKS: Record<string, string> = {
  choose: "Waiting for you to answer",
  connect_app: "Waiting for you to sign in",
  request_folder: "Waiting for you to pick a folder",
};

/**
 * Where a task stands and what to say about it.
 *
 * The list reads this rather than the task's own status because the status
 * says whether an agent is alive, and the list has to answer the harder
 * question: what happened. So a finished task's line is the agent's own last
 * words, and a task that stopped to ask says what it is asking for.
 */
export async function taskStanding({
  isRunning,
  taskId,
}: {
  isRunning: boolean;
  taskId: TaskId;
}): Promise<TaskStanding> {
  if (isRunning) {
    const step = await latestStep(taskId);
    return { kind: "running", line: step ?? "Working" };
  }
  const waiting = await pendingAsk(taskId);
  if (waiting) {
    return { kind: "waiting", line: waiting };
  }
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return { kind: "done", line: "Nothing yet" };
  }
  const said = await lastAssistantText({
    maxLength: LINE_MAX,
    sessionId: sessionId.value,
    taskId,
  });
  return { kind: "done", line: firstLine(said) };
}

/** The agent's last words as one line, since the list has room for one. */
function firstLine(text: string | undefined): string {
  if (!text) {
    return "Finished without a word";
  }
  const line = text.split("\n").find((part) => part.trim()) ?? text;
  const trimmed = line.trim();
  return trimmed.length > LINE_MAX ? `${trimmed.slice(0, LINE_MAX)}…` : trimmed;
}

/**
 * What the task asked the user for and has not been answered, when its last
 * turn ended on an ask rather than on words.
 */
async function pendingAsk(taskId: TaskId): Promise<string | undefined> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return undefined;
  }
  const messages = await Store.getMessagesWithParts({
    sessionId: sessionId.value,
    taskId,
  });
  if (messages.isErr()) {
    return undefined;
  }
  const last = messages.value.findLast(
    (message) => message.role === "assistant",
  );
  for (const part of last?.parts ?? []) {
    const name = part.type.startsWith("tool-")
      ? part.type.slice("tool-".length)
      : undefined;
    if (
      name &&
      ASKS[name] &&
      "state" in part &&
      (part.state === "input-available" || part.state === "input-streaming")
    ) {
      return ASKS[name];
    }
  }
  return undefined;
}
