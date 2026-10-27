import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { z } from "zod";

import {
  AGENT_FILES_LANGUAGE,
  INTERRUPTED_TOOL_CALL_ERROR_TEXT,
} from "../../constants";
import { type SessionMessage } from "../../schemas/session/message";
import { asClause } from "../as-clause";
import { describeMessageError } from "../describe-message-error";
import { parseFilesBlock } from "../parse-files-block";
import { cardLine } from "./asks";
import { openAsksOf } from "./open-asks";
import { ChatReads } from "../chat-reads";
import {
  type Derived,
  indexedByRecords,
  kept,
  unkept,
} from "../workspace-index";
import { latestStep, ownMessages, type SessionRef } from "./activity";
import { lastAssistantTextIn } from "./latest-session";

/** How much of the agent's own words the list shows on a task's second line. */
const LINE_MAX = 90;

/**
 * Where a task with no agent at work stands, read from its store alone, so it
 * holds until something writes there. The list asks for every task it shows
 * each time it is read, and this is a whole transcript or more per task.
 */
const settledStanding = indexedByRecords<TaskStanding>("task_standings");

/**
 * How a turn ended when it ended without words: whether a model error ended
 * it, whether sending the task on picks it up again, and the line that says
 * so. A stop names what it ended in `stoppedWhile`, so the note can say who
 * stopped it in its own words.
 */
export interface TaskEnding {
  failed: boolean;
  line: string;
  resumable: boolean;
  stoppedWhile?: string;
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

/**
 * Where a task stands, in the four words the list can say it in. A turn that
 * did not finish on its own and was nobody's decision is `failed`: a model
 * error, a request that timed out, or the app quitting while the task worked.
 */
export const TaskStandingKindSchema = z.enum([
  "done",
  "failed",
  "running",
  "waiting",
]);

type TaskStandingKind = z.output<typeof TaskStandingKindSchema>;

/**
 * How a turn that ended before the agent wrote any words ended. That happens
 * four ways, each of which leaves the last assistant message text-less: the
 * step limit, a model error, a request that timed out, or a stop, whether the
 * user's or the chat's, which lands either in the message the model was
 * streaming or in the tool call it was waiting on. The line names the one it
 * was and, for a timeout or a stop, what the task was in the middle of. Read by the task list and
 * by the note that wakes the chat, so the two say the same thing.
 */
export async function endedWithoutWords(ref: SessionRef): Promise<TaskEnding> {
  return endingIn(ref, await ownMessages(ref));
}

/**
 * The line for a turn the app's quitting ended, naming what the task was in
 * the middle of when that is known. Read by the task list and by the note
 * the chat gets as the app quits, so the two say the same thing.
 */
export function appClosedLine(step: string | undefined): string {
  return step
    ? `The app closed while ${asClause(step)}`
    : "The app closed before it finished";
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
 * A task whose turn ended with a card it ran into still up is waiting,
 * whatever it last said: the person's answer wakes it, and until they answer
 * or stop it, it is waiting on them.
 */
export async function taskStanding({
  isRunning,
  sessionId,
  chatId,
}: SessionRef & { isRunning: boolean }): Promise<TaskStanding> {
  const ref = { sessionId, chatId };
  if (isRunning) {
    return { kind: "running", line: (await latestStep(ref)) ?? "Working" };
  }
  // Read apart from the rest, which holds until the task's store is written:
  // a card is in the chat's state, and goes without a write to the store.
  const [card] = await openAsksOf(chatId, sessionId);
  if (card) {
    return { kind: "waiting", line: cardLine(card) };
  }
  return settledStanding(chatId, sessionId, () => standingAtRest(ref));
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
  ref: SessionRef,
  messages: SessionMessage.WithParts[],
): Promise<TaskEnding> {
  const last = messages.findLast((message) => message.role === "assistant");
  if (last?.metadata.finishReason === "max-steps") {
    for (const part of last.parts) {
      if (part.type === "data-maxSteps") {
        return {
          failed: false,
          line: `Stopped at the ${part.data.maxStepCount}-step limit`,
          resumable: true,
        };
      }
    }
    return {
      failed: false,
      line: "Stopped at its step limit",
      resumable: true,
    };
  }
  // Not a failure either: the model wrote until it ran out of room, as many
  // times as it was given, and what it wrote is in the transcript.
  if (last?.metadata.finishReason === "length") {
    return {
      failed: false,
      line: "Cut off at the output limit",
      resumable: true,
    };
  }
  const error = last?.metadata.error;
  if (error && error.kind !== "aborted") {
    return {
      failed: true,
      line: describeMessageError(error).summary,
      resumable: true,
    };
  }
  const step = await latestStep(ref);
  // A request let go for going quiet past its timeout ended the turn the way
  // a model error does: nobody decided it, and sending the task on picks it
  // up again.
  if (error?.reason === "timeout") {
    return {
      failed: true,
      line: step ? `Timed out while ${asClause(step)}` : "Timed out",
      resumable: true,
    };
  }
  return {
    failed: false,
    line: step ? `Stopped while ${asClause(step)}` : "Stopped",
    resumable: false,
    ...(step ? { stoppedWhile: asClause(step) } : {}),
  };
}

async function standingAtRest(ref: SessionRef): Promise<Derived<TaskStanding>> {
  // One read answers all three: what it is asking, what it last said, and
  // how it ended when it said nothing. Its own messages alone, since what it
  // carries on from is the chat's.
  const messages = await ChatReads.transcript({ ...ref, inherited: false });
  const transcript = messages.isOk() ? messages.value : [];
  const session = await ChatReads.session(ref);
  const settle = messages.isOk() && session.isOk() ? kept : unkept;
  // Ahead of the rest: a turn the app's quitting cut off may have said words
  // or asked something on an earlier step, and neither is where it ended.
  if (
    (session.isOk() && session.value.stoppedBy === "app") ||
    endedByAppClosing(transcript)
  ) {
    return settle({
      kind: "failed",
      line: appClosedLine(await latestStep(ref)),
    });
  }
  // A turn that ended on a card no answer has reached, with no card up here:
  // the card is in the state of the computer the task runs on, which this
  // one does not read, and the record shows only the call it ended on. The
  // person's Stop takes a task off its cards and says so on its session.
  if (
    endedOnAPermissionAsk(transcript) &&
    !(session.isOk() && session.value.stoppedBy !== undefined)
  ) {
    return settle({ kind: "waiting", line: WAITING_ELSEWHERE });
  }
  // Read whole and cut after: the line is chosen from the reply's shape, and a
  // fence cut off mid-way is a fence the excerpt cannot read.
  const said = lastAssistantTextIn(transcript);
  if (said) {
    return settle({ kind: "done", line: excerptOf(said, LINE_MAX) });
  }
  const ending = await endingIn(ref, transcript);
  return settle({ kind: ending.failed ? "failed" : "done", line: ending.line });
}

/** What a task waiting on a card raised on another computer says it waits for. */
const WAITING_ELSEWHERE =
  "Waiting for your permission on the computer it runs on";

/**
 * Whether the task's record ends on an `ask_permission` call that put a card
 * up, with nothing after it: an answer would have woken the task with a
 * message of its own.
 */
function endedOnAPermissionAsk(messages: SessionMessage.WithParts[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        part.type === "tool-ask_permission" &&
        part.state === "output-available" &&
        part.output.state === "asked",
    )
  );
}

/**
 * Whether the last turn ended on a call the app's closing cut off, which is
 * what the store's open-time sweep writes on a call left in flight. Covers a
 * process that ended without marking its tasks, as a crash does.
 */
function endedByAppClosing(messages: SessionMessage.WithParts[]): boolean {
  const last = messages.findLast((message) => message.role === "assistant");
  return (
    last?.parts.some(
      (part) =>
        "errorText" in part &&
        part.errorText === INTERRUPTED_TOOL_CALL_ERROR_TEXT,
    ) ?? false
  );
}
