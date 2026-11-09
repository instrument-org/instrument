import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { describeMessageError } from "../describe-message-error";
import { excerptOf, lastAssistantTextIn, LINE_MAX } from "./reply-excerpt";
import { latestStepIn } from "./step-label";

/**
 * One stretch of a task's own log that a card in the chat stands for: from
 * the message that started it (the task's first, or one the chat sent it) up
 * to the next message from the chat, or the end. Read from the records alone,
 * and an earlier stretch reads only what was written before the next one
 * began, so it never changes once a later one has.
 */
export interface TaskSlice {
  /** When its last record was written, its work summary aside. */
  endedAt: Date;
  /** Whether a model error ended it. */
  failed?: true;
  /**
   * The chat sent the next message while its last step was still running, so
   * it ended at that send with its work still going on in the next stretch.
   */
  handedOn?: true;
  /** The message it starts at. */
  from: StoreId.Message;
  /**
   * What it came to: the error that ended it, its work summary, its last
   * words, or its last step. Absent while it has none of them.
   */
  line?: string;
  /** When its first message was written. */
  startedAt: Date;
}

/** A task's own messages cut into the stretches its cards stand for, oldest first. */
export function taskSlices(messages: SessionMessage.WithParts[]): TaskSlice[] {
  const runs: SessionMessage.WithParts[][] = [];
  for (const message of messages) {
    const current = runs.at(-1);
    if (current && !sentByTheChat(message)) {
      current.push(message);
    } else {
      runs.push([message]);
    }
  }
  return runs.flatMap((run, index) => {
    const [first] = run;
    if (!first) {
      return [];
    }
    // A step in flight when the chat sent goes on writing into the message
    // it began in, which sorts before the send. What it wrote after the send
    // is the next stretch's.
    const next = runs[index + 1]?.[0]?.metadata.createdAt.getTime();
    const cut = next ?? Infinity;
    const kept = run.map((message) => ({
      ...message,
      parts: message.parts.filter(
        (part) => part.metadata.createdAt.getTime() <= cut,
      ),
    }));
    const last = run.findLast((message) => message.role === "assistant");
    const finishedInIt = (finishedAtOf(last) ?? Infinity) <= cut;
    // An error the step in flight met after the send ended the next stretch.
    const ending = endingOf(kept, finishedInIt);
    return [
      {
        endedAt: new Date(Math.min(cut, Math.max(...kept.map(lastWrittenAt)))),
        ...(ending.failed && { failed: true as const }),
        from: first.id,
        ...(next !== undefined && !finishedInIt && { handedOn: true as const }),
        ...(ending.line !== undefined && { line: ending.line }),
        startedAt: first.metadata.createdAt,
      },
    ];
  });
}

/** A message the chat sent into the task after it started (`task send`). */
function sentByTheChat(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) => part.type === "data-fromChat" && part.data.kind === "message",
    )
  );
}

function finishedAtOf(
  message: SessionMessage.WithParts | undefined,
): number | undefined {
  return message?.role === "assistant"
    ? message.metadata.finishedAt?.getTime()
    : undefined;
}

/** How a run ended, its last step's error counted only where `endedInIt`. */
function endingOf(
  run: SessionMessage.WithParts[],
  endedInIt: boolean,
): {
  failed: boolean;
  line?: string;
} {
  const last = run.findLast((message) => message.role === "assistant");
  const error = last?.role === "assistant" ? last.metadata.error : undefined;
  if (error && error.kind !== "aborted" && endedInIt) {
    return { failed: true, line: describeMessageError(error).summary };
  }
  const summary = last?.parts.find((part) => part.type === "data-workSummary")
    ?.data.words;
  if (summary !== undefined) {
    return { failed: false, line: summary };
  }
  const said = lastAssistantTextIn(run);
  const line = said ? excerptOf(said, LINE_MAX) : latestStepIn(run);
  return { failed: false, ...(line !== undefined && { line }) };
}

/**
 * When a message's work was last written. Its work summary is left out: a
 * separate call writes it after the turn, and the work ended before that.
 */
function lastWrittenAt(message: SessionMessage.WithParts): number {
  const times = [
    message.metadata.createdAt.getTime(),
    finishedAtOf(message) ?? 0,
  ];
  for (const part of message.parts) {
    if (part.type === "data-workSummary") {
      continue;
    }
    times.push(part.metadata.createdAt.getTime());
    const { endedAt } = part.metadata;
    if (endedAt instanceof Date) {
      times.push(endedAt.getTime());
    }
  }
  return Math.max(...times);
}
