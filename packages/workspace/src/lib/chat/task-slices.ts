import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { lastAssistantTextIn } from "./latest-session";
import { excerptOf } from "./reply-excerpt";
import { latestStepIn } from "./step-label";
import { LINE_MAX } from "./task-status";

/**
 * One stretch of a task's own log that a card in the chat stands for: from
 * the message that started it (the task's first, or one the chat sent it) up
 * to the next message from the chat, or the end. Read from the records alone,
 * so an earlier stretch never changes once a later one has begun.
 */
export interface TaskSlice {
  /** When its last record was written. */
  endedAt: Date;
  /** The message it starts at. */
  from: StoreId.Message;
  /**
   * What it came to: its work summary, else its last words, else its last
   * step. Absent while it has none of them.
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
  return runs.flatMap((run) => {
    const [first] = run;
    if (!first) {
      return [];
    }
    const line = lineOf(run);
    return [
      {
        endedAt: new Date(Math.max(...run.map(lastWrittenAt))),
        from: first.id,
        ...(line !== undefined && { line }),
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

function lineOf(run: SessionMessage.WithParts[]): string | undefined {
  const summary = run
    .findLast((message) => message.role === "assistant")
    ?.parts.find((part) => part.type === "data-workSummary")?.data.words;
  if (summary !== undefined) {
    return summary;
  }
  const said = lastAssistantTextIn(run);
  return said ? excerptOf(said, LINE_MAX) : latestStepIn(run);
}

function lastWrittenAt(message: SessionMessage.WithParts): number {
  const times = [message.metadata.createdAt.getTime()];
  if ("finishedAt" in message.metadata && message.metadata.finishedAt) {
    times.push(message.metadata.finishedAt.getTime());
  }
  for (const part of message.parts) {
    times.push(part.metadata.createdAt.getTime());
    const { endedAt } = part.metadata;
    if (endedAt instanceof Date) {
      times.push(endedAt.getTime());
    }
  }
  return Math.max(...times);
}
