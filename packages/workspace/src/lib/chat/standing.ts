import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { AGENT_FILES_LANGUAGE } from "../../constants";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { asClause } from "../as-clause";
import { describeMessageError } from "../describe-message-error";
import { parseFilesBlock } from "../parse-files-block";
import { Store } from "../store";
import { taskHold } from "../task-hold";
import { type Derived, indexedByStore, kept, unkept } from "../workspace-index";
import { askIn, latestStep, runningLines } from "./activity";
import { lastAssistantTextIn, latestSessionId } from "./latest-session";

/** How much of the agent's own words the list shows on a task's second line. */
const LINE_MAX = 90;

/**
 * Where a task with no agent at work stands, read from its store alone, so it
 * holds until something writes there. The list asks for every task it shows
 * each time it is read, and this is a whole transcript or more per task.
 */
const settledStanding = indexedByStore<TaskStanding>("task_standings");

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

/**
 * How a turn that ended before the agent wrote any words ended. That happens
 * three ways, each of which leaves the last assistant message text-less: the
 * step limit, a model error, or a stop, whether the user's or the
 * chat's, which lands either in the message the model was streaming
 * or in the tool call it was waiting on. The line names the one it was and,
 * for a stop, what the task was in the middle of. Read by the task list and
 * by the note that wakes the chat, so the two say the same thing.
 */
export async function endedWithoutWords(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<TaskEnding> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  return endingIn(taskId, messages.isOk() ? messages.value : []);
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
 * Where a task stands and what to say about it.
 *
 * The list reads this rather than the task's own status because the status
 * says whether an agent is alive, and the list has to answer the harder
 * question: what happened. So a finished task's line is the agent's own last
 * words, a task that stopped to ask says what it is asking for, and one whose
 * turn ended without words says how it ended.
 *
 * A running task can be waiting too: its agent stays alive while an ask of
 * its own sits unanswered, and the list says what it is waiting for rather
 * than showing a step that is not moving. A task held from starting waits on
 * whatever holds it.
 */
export async function taskStanding({
  isRunning,
  taskId,
}: {
  isRunning: boolean;
  taskId: TaskId;
}): Promise<TaskStanding> {
  const held = taskHold(taskId);
  if (held) {
    return { kind: "waiting", line: held.userReason };
  }
  if (isRunning) {
    const { step, waiting } = await runningLines(taskId);
    return waiting
      ? { kind: "waiting", line: waiting }
      : { kind: "running", line: step ?? "Working" };
  }
  return settledStanding(taskId, () => standingAtRest(taskId));
}

/** The last segment of a path, which is how a file is named in a line. */
function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

function cut(line: string, maxLength: number): string {
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line;
}

/** The same ending, read from a transcript already in hand. */
async function endingIn(
  taskId: TaskId,
  messages: SessionMessage.WithParts[],
): Promise<TaskEnding> {
  const last = messages.findLast((message) => message.role === "assistant");
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

async function standingAtRest(taskId: TaskId): Promise<Derived<TaskStanding>> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr()) {
    return unkept({ kind: "done", line: "Nothing yet" });
  }
  if (!sessionId.value) {
    return kept({ kind: "done", line: "Nothing yet" });
  }
  // One read answers all three: what it is asking, what it last said, and
  // how it ended when it said nothing.
  const messages = await Store.getMessagesWithParts({
    sessionId: sessionId.value,
    taskId,
  });
  const transcript = messages.isOk() ? messages.value : [];
  const settle = messages.isOk() ? kept : unkept;
  // A turn that ended on an ask rather than on words is waiting on the user.
  const waiting = askIn(transcript);
  if (waiting) {
    return settle({ kind: "waiting", line: waiting });
  }
  // Read whole and cut after: the line is chosen from the reply's shape, and a
  // fence cut off mid-way is a fence the excerpt cannot read.
  const said = lastAssistantTextIn(transcript);
  if (said) {
    return settle({ kind: "done", line: excerptOf(said, LINE_MAX) });
  }
  const ending = await endingIn(taskId, transcript);
  return settle({ kind: ending.failed ? "failed" : "done", line: ending.line });
}
