import { z } from "zod";

import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../constants";
import { type SessionMessage } from "../../schemas/session/message";
import { asClause } from "../as-clause";
import { describeMessageError } from "../describe-message-error";
import { cardLine } from "./asks";
import { openAsksOf } from "./open-asks";
import { ChatReads } from "../chat-reads";
import { excerptOf, lastAssistantTextIn, LINE_MAX } from "./reply-excerpt";
import {
  type Derived,
  indexedByRecords,
  kept,
  unkept,
} from "../workspace-index";
import { latestStep, ownMessages, type SessionRef } from "./activity";
import { needsNamedIn } from "../parse-needs-block";
import { sessionOfChat } from "../record-folders";

/**
 * Where a task with no agent at work stands, read from its store alone, so it
 * holds until something writes there. The list asks for every task it shows
 * each time it is read, and this is a whole transcript or more per task.
 */
const settledStatus = indexedByRecords<TaskStatus>("task_statuses");

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

export interface TaskStatus {
  kind: TaskStatusKind;
  /**
   * The line under the title: the step while it runs, what it waits for while
   * it waits, what it made once it is done, and how it ended when it ended
   * before saying. Never the word "done" alone.
   */
  line: string;
  /** What its last words said it cannot go on without, from their needs fences. */
  needs?: string[];
  /**
   * The line its finished turn's work came to, for a person's list. `line`
   * stays its own words, which is what the chat reads of it.
   */
  summary?: string;
}

/**
 * Where a task stands, in the four words the list can say it in. A turn that
 * did not finish on its own and was nobody's decision is `failed`: a model
 * error, a request that timed out, or the app quitting while the task worked.
 */
export const TaskStatusKindSchema = z.enum([
  "done",
  "failed",
  "running",
  "waiting",
]);

type TaskStatusKind = z.output<typeof TaskStatusKindSchema>;

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
export async function taskStatus({
  isRunning,
  sessionId,
  chatId,
}: SessionRef & { isRunning: boolean }): Promise<TaskStatus> {
  const ref = { sessionId, chatId };
  if (isRunning) {
    return { kind: "running", line: (await latestStep(ref)) ?? "Working" };
  }
  // Read apart from the rest, which holds until the task's own records are
  // written: a card is in the chat's own session's log, whichever computer
  // raised it.
  const [card] = await openAsksOf(chatId, sessionId);
  if (card) {
    return { kind: "waiting", line: cardLine(card) };
  }
  const settled = await settledStatus(chatId, sessionId, () =>
    statusAtRest(ref),
  );
  // A task that ended on what it needs hands that to the chat, which asks
  // the person for it: while the chat has a card up, the task is paused on
  // them rather than done.
  const [need] = settled.needs ?? [];
  const chat = sessionOfChat(chatId);
  if (
    need !== undefined &&
    chat !== undefined &&
    (await openAsksOf(chatId, chat)).length > 0
  ) {
    return { kind: "waiting", line: `Paused for ${need}` };
  }
  return settled;
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

async function statusAtRest(ref: SessionRef): Promise<Derived<TaskStatus>> {
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
  // Read whole and cut after: the line is chosen from the reply's shape, and a
  // fence cut off mid-way is a fence the excerpt cannot read.
  const said = lastAssistantTextIn(transcript);
  if (said) {
    const summary = transcript
      .findLast((message) => message.role === "assistant")
      ?.parts.find((part) => part.type === "data-workSummary")?.data.words;
    const needs = needsNamedIn(said);
    return settle({
      kind: "done",
      line: excerptOf(said, LINE_MAX),
      ...(needs.length > 0 && { needs }),
      ...(summary !== undefined && { summary }),
    });
  }
  const ending = await endingIn(ref, transcript);
  return settle({ kind: ending.failed ? "failed" : "done", line: ending.line });
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
