import { alphabetical } from "radashi";
import { z } from "zod";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { listTaskBackgroundProcesses } from "../background-processes";
import { getTaskAgentStatus } from "../get-task-agent-status";
import { isToolPart } from "../is-tool-part";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { listChildTasks } from "./children";
import { latestSessionId } from "./latest-session";
import { type LeftRunning } from "./left-running";
import { type ChatId } from "../../schemas/chat-id";

const RunningTaskSchema = z.object({
  /** What the task is doing this moment, in its agent's own label, when it gave one. */
  step: z.string().optional(),
  taskId: TaskIdSchema,
  /** The chat it was filed from, by session id; absent for a task filed outside a turn. */
  chat: z.string().optional(),
  title: z.string(),
  /** When something last happened in it, in ms. */
  updatedAt: z.number(),
  /**
   * What it has stopped to ask the user for. Present while its agent is alive
   * but paused on an ask, which is running to the machine and stalled to the
   * user, so a reader takes this over the step.
   */
  waiting: z.string().optional(),
});

export const ChatActivitySchema = z.object({
  running: RunningTaskSchema.array(),
});
export type ChatActivity = z.output<typeof ChatActivitySchema>;

/** What a pending ask is waiting for, in the user's terms. */
const ASKS: Record<string, string> = {
  choose: "Waiting for you to answer",
  connect_app: "Waiting for you to sign in",
  request_folder: "Waiting for you to pick a folder",
};

/** How much of a step's label the conversation shows. */
const STEP_MAX_LENGTH = 80;

/**
 * What a transcript's last turn stopped to ask the user for, when it ended on
 * an ask rather than on words: the ask's tool call is still waiting for its
 * input to be answered.
 */
export function askIn(
  messages: SessionMessage.WithParts[],
): string | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
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
      // The question itself where there is one, since that is what the user
      // is being asked; the generic line where the ask has no words of its
      // own.
      return (name === "choose" && questionOf(part)) || ASKS[name];
    }
  }
  return undefined;
}

export function isWorking(taskId: TaskId) {
  const status = getTaskAgentStatus({
    id: taskId,
    workspaceRef: getWorkspaceActorRef(),
  });
  return (
    status.isOk() &&
    status.value.sessionActors.some((actor) =>
      actor.tags.includes("agent.alive"),
    )
  );
}

/** The transcript of the task's latest session; empty when it has none or the read fails. */
export async function latestMessages(
  taskId: TaskId,
): Promise<SessionMessage.WithParts[]> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return [];
  }
  const messages = await Store.getMessagesWithParts({
    sessionId: sessionId.value,
    taskId,
  });
  return messages.isOk() ? messages.value : [];
}

/**
 * The label on the newest tool call of the task's latest session, read from
 * the newest message back and stopping at the first that has one, so a
 * task at work is not read whole on every change.
 */
export async function latestStep(taskId: TaskId): Promise<string | undefined> {
  for await (const message of newestFirst(taskId)) {
    const step = latestStepIn([message]);
    if (step !== undefined) {
      return step;
    }
  }
  return undefined;
}

/**
 * The messages of the task's latest session, newest first, each read only
 * when the one after it has been looked at. Nothing for a task with no
 * session; a message that cannot be read is skipped, as a whole read does.
 */
async function* newestFirst(
  taskId: TaskId,
): AsyncGenerator<SessionMessage.WithParts> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return;
  }
  const ids = await Store.getMessageIds(sessionId.value, taskId);
  if (ids.isErr()) {
    return;
  }
  for (const messageId of alphabetical(ids.value, (id) => id).toReversed()) {
    const message = await Store.getMessageWithParts({
      messageId,
      sessionId: sessionId.value,
      taskId,
    });
    if (message.isOk()) {
      yield message.value;
    }
  }
}

/**
 * The line a task at work is read by: the phase its newest call belongs to,
 * or that call's explanation when it named none. The phase comes first
 * because it changes once every few calls and says why the work is
 * happening, where the explanation changes on every call.
 *
 * A call still streaming in is saved as its input arrives, and the activity
 * is written first, so a new phase would show a word at a time. Its activity
 * counts once another field has started after it; until then the line stays
 * on the call before.
 */
export function latestStepIn(
  messages: SessionMessage.WithParts[],
): string | undefined {
  for (const message of messages.toReversed()) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts.toReversed()) {
      if (!isToolPart(part)) {
        continue;
      }
      const input: unknown = part.input;
      if (typeof input !== "object" || input === null) {
        continue;
      }
      const isActivityComplete =
        part.state !== "input-streaming" ||
        Object.keys(input).some((key) => key !== "activity");
      const label =
        "activity" in input &&
        typeof input.activity === "string" &&
        input.activity.trim() &&
        isActivityComplete
          ? input.activity
          : "explanation" in input && typeof input.explanation === "string"
            ? input.explanation
            : undefined;
      if (label?.trim()) {
        return label.length > STEP_MAX_LENGTH
          ? `${label.slice(0, STEP_MAX_LENGTH)}…`
          : label;
      }
    }
  }
  return undefined;
}

/**
 * What a task has running in the background right now, oldest first.
 *
 * Every session of the task, because the chat reads a task the way the
 * user does: what a subagent of it started is the task's. A different fact
 * from `isWorking`, and the two come apart exactly when it matters: a task
 * whose turn ended with a scan still going is idle and has this.
 */
export function leftRunning(taskId: TaskId, now = Date.now()): LeftRunning[] {
  return listTaskBackgroundProcesses(taskId)
    .filter((process) => process.status === "running")
    .map((process) => ({
      command: process.command,
      id: process.id,
      runningForMs: Math.max(0, now - process.startedAt.getTime()),
    }));
}

/**
 * What is happening behind the conversation right now: each task of the
 * chat's that is at work, and the label on its latest step. The
 * conversation shows this under its transcript, so a reply that handed the
 * work off does not read as the end of it.
 */
export async function chatActivity(chatId: ChatId): Promise<ChatActivity> {
  const children = await listChildTasks(chatId, (id) => isWorking(id));
  const running = await Promise.all(
    children.map(async (child) => {
      const chat = sessionOfChat(child.chatId);
      return {
        ...(await runningLines(child.id)),
        taskId: child.id,
        ...(chat ? { chat } : {}),
        title: child.title,
        updatedAt: child.updatedAt.getTime(),
      };
    }),
  );
  return { running };
}

/**
 * The lines a task at work is read by, from one read of its transcript: the
 * label on its latest step, and what it has paused to ask the user for. Both
 * can be present at once, since the ask sits where a step would; a reader
 * takes the ask first, because a task paused on one is going nowhere until
 * it is answered.
 */
export async function runningLines(
  taskId: TaskId,
): Promise<{ step?: string; waiting?: string }> {
  // Newest first, as far back as the step: the ask is only ever in the
  // newest assistant message, which comes first.
  let waiting: string | undefined;
  let askRead = false;
  let step: string | undefined;
  for await (const message of newestFirst(taskId)) {
    if (!askRead && message.role === "assistant") {
      waiting = askIn([message]);
      askRead = true;
    }
    step = latestStepIn([message]);
    if (step !== undefined) {
      break;
    }
  }
  return { ...(step ? { step } : {}), ...(waiting ? { waiting } : {}) };
}

/**
 * When the task's current turn began: the moment the last message reached
 * it. Wall-clock, because a task can spend minutes inside one model reply,
 * which no tool timing counts.
 */
export async function turnStartedAt(taskId: TaskId): Promise<Date | undefined> {
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
  return messages.value.findLast((message) => message.role === "user")?.metadata
    .createdAt;
}

/** The words of a choice put to the user, when the call carries them. */
function questionOf(part: SessionMessagePart.Type): string {
  const input: unknown = "input" in part ? part.input : undefined;
  return typeof input === "object" &&
    input !== null &&
    "question" in input &&
    typeof input.question === "string"
    ? input.question.trim()
    : "";
}
