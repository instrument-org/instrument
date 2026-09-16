import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { AGENT_FILES_LANGUAGE } from "../../constants";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { asClause } from "../as-clause";
import { describeMessageError } from "../describe-message-error";
import { parseFilesBlock } from "../parse-files-block";
import { Store } from "../store";
import { latestStep } from "./activity";
import { lastAssistantText, latestSessionId } from "./latest-session";

/** How much of the agent's own words the list shows on a task's second line. */
const LINE_MAX = 90;

/**
 * How a turn ended when it ended without words: whether a model error ended
 * it, and the line that says so.
 */
export interface TaskEnding {
  failed: boolean;
  line: string;
}

export interface TaskStanding {
  kind: TaskStandingKind;
  /**
   * The line under the title: the step while it runs, what it waits for while
   * it waits, what it made once it is done, and how it ended when it ended
   * before saying. Never the word "done" alone.
   */
  line: string;
}

/** Where a task stands, in the four words the list can say it in. */
type TaskStandingKind = "done" | "failed" | "running" | "waiting";

/** What a pending ask is waiting for, in the user's terms. */
const ASKS: Record<string, string> = {
  choose: "Waiting for you to answer",
  connect_app: "Waiting for you to sign in",
  request_folder: "Waiting for you to pick a folder",
};

/** The same question, read from a transcript already in hand. */
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
      return ASKS[name];
    }
  }
  return undefined;
}

/**
 * How a turn that ended before the agent wrote any words ended. That happens
 * three ways, each of which leaves the last assistant message text-less: the
 * step limit, a model error, or a stop, whether the user's or the
 * orchestrator's, which lands either in the message the model was streaming
 * or in the tool call it was waiting on. The line names the one it was and,
 * for a stop, what the task was in the middle of. Read by the task list and
 * by the note that wakes the orchestrator, so the two say the same thing.
 */
export async function endedWithoutWords(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<TaskEnding> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  const last = messages.isOk()
    ? messages.value.findLast((message) => message.role === "assistant")
    : undefined;
  if (last?.metadata.finishReason === "max-steps") {
    for (const part of last.parts) {
      if (part.type === "data-maxSteps") {
        return {
          failed: false,
          line: `Stopped at the ${part.data.maxStepCount}-step limit`,
        };
      }
    }
    return { failed: false, line: "Stopped at its step limit" };
  }
  const error = last?.metadata.error;
  if (error && error.kind !== "aborted") {
    return { failed: true, line: describeMessageError(error).summary };
  }
  const step = await latestStep(taskId);
  return {
    failed: false,
    line: step ? `Stopped while ${asClause(step)}` : "Stopped",
  };
}

/**
 * The one line a reply is read by, cut to what a row can show. Fenced blocks
 * are skipped whole: a reply that opens with the files it hands over is read
 * by its words. One that is nothing but that fence is read by what it wrote,
 * named from the fence's basenames, and any other fence with no words around
 * it by its first line, so no excerpt ever shows the fence itself.
 */
export function excerptOf(text: string, maxLength: number): string {
  /** The info string of the fence being walked; undefined outside one. */
  let fence: string | undefined;
  const fencedFiles: string[] = [];
  let firstFenced: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fence = fence === undefined ? line.replace(/^`+/, "").trim() : undefined;
      continue;
    }
    if (!line) {
      continue;
    }
    if (fence === undefined) {
      // Plain words: a row has no room for a bold marker or a link's target.
      return cut(stripMarkdown(line).trim(), maxLength);
    }
    if (fence === AGENT_FILES_LANGUAGE) {
      fencedFiles.push(line);
    }
    firstFenced ??= line;
  }
  const names = parseFilesBlock(fencedFiles.join("\n")).map(basename);
  const [first, ...more] = names;
  if (first === undefined) {
    return cut(firstFenced ?? "", maxLength);
  }
  return more.length === 0
    ? cut(`Wrote ${first}`, maxLength)
    : cut(`Wrote ${names.length} files: ${names.join(", ")}`, maxLength);
}

/**
 * What a conversation is waiting on the user for, when its last turn ended on
 * an ask rather than on words. A thread is a session, so this is also how a
 * thread says it has stopped and needs an answer.
 */
export async function sessionAsk(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<string | undefined> {
  const messages = await Store.getMessagesWithParts({
    sessionId,
    taskId,
  });
  if (messages.isErr()) {
    return undefined;
  }
  return askIn(messages.value);
}

/**
 * Where a task stands and what to say about it.
 *
 * The list reads this rather than the task's own status because the status
 * says whether an agent is alive, and the list has to answer the harder
 * question: what happened. So a finished task's line is the agent's own last
 * words, a task that stopped to ask says what it is asking for, and one whose
 * turn ended without words says how it ended.
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
  // Read whole and cut after: the line is chosen from the reply's shape, and a
  // fence cut off mid-way is a fence the excerpt cannot read.
  const said = await lastAssistantText({
    sessionId: sessionId.value,
    taskId,
  });
  if (said) {
    return { kind: "done", line: excerptOf(said, LINE_MAX) };
  }
  const ending = await endedWithoutWords(taskId, sessionId.value);
  return { kind: ending.failed ? "failed" : "done", line: ending.line };
}

/** The last segment of a path, which is how a file is named in a line. */
function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

function cut(line: string, maxLength: number): string {
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line;
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
  return sessionAsk(taskId, sessionId.value);
}
