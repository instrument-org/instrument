import { alphabetical, parallel } from "radashi";
import { z } from "zod";

import { type Session } from "../../schemas/session";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { isToolPart } from "../is-tool-part";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { Store } from "../store";
import {
  appSlugsIn,
  bashCommandOf,
  firstLine,
  hasWords,
  openedHostsIn,
  textOf,
} from "./threads";

/** How many entries a list holds when the caller names no limit. */
export const ACTIVITY_LOG_LIMIT = 300;

/** How many threads are read at once when the log is built. */
const READ_LIMIT = 8;

/** A `task new` that made a task, by what the command printed: the id, and the name it was given. */
const CREATED = /^Created (\S+)(?: \("([^"]*)"\))?/m;
const TASK_NEW = /(?:^|[\n;&|])\s*task new\b/;

export const ActivityEntrySchema = z.object({
  /** When it happened, in ms. */
  at: z.number(),
  /**
   * Stable across re-lists: the session, the message, and the kind, with an
   * index behind them from the second entry of a kind one message yields.
   */
  id: z.string(),
  kind: z.enum([
    "asked",
    "askedYou",
    "madeFile",
    "openedPage",
    "replied",
    "startedTask",
    "taskFailed",
    "taskFinished",
    "taskOverdue",
    "usedApp",
  ]),
  /** What the row draws as marks, for the kinds that have any. */
  marks: z
    .object({
      apps: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      sites: z.array(z.string()).optional(),
    })
    .optional(),
  /** The task an entry is about, for the kinds that are, so the row can open it. */
  taskId: TaskIdSchema.optional(),
  /** One line: the ask, the reply's first line, the task's title, the file's name, the app, the host, the question. */
  text: z.string(),
  /** The thread it happened in, as the row names it. */
  thread: z.object({
    id: StoreId.SessionSchema,
    title: z.string(),
    topics: z.array(z.string()),
  }),
});

export type ActivityEntry = z.output<typeof ActivityEntrySchema>;

type Kind = ActivityEntry["kind"];

/**
 * What happened across every thread of the conversation, newest first: what
 * the user asked, what the agent replied and did, tasks starting and ending,
 * files handed over, apps and sites used, and what the agent asked the user.
 * Nothing is stored for it; every entry is read out of the threads' messages,
 * so the log says exactly what the threads say.
 */
export async function listActivityLog(
  taskId: TaskId,
  { limit = ACTIVITY_LOG_LIMIT }: { limit?: number } = {},
): Promise<ActivityEntry[]> {
  const sessions = await Store.getSessions(taskId);
  if (sessions.isErr()) {
    return [];
  }
  const perThread = await parallel(
    { limit: READ_LIMIT },
    alphabetical(sessions.value, (session) => session.id),
    (session) => entriesOf(taskId, session),
  );
  // Ties keep transcript order, so a reply's own line stays above the files
  // it handed over, and the newest lands at the top of the list.
  return perThread
    .flat()
    .sort((a, b) => a.at - b.at)
    .reverse()
    .slice(0, limit);
}

/**
 * The question a call put to the user, out of its input: what a choice asks,
 * or the reason an app or a folder is wanted.
 */
function askedIn(part: SessionMessagePart.ToolPart): string | undefined {
  switch (part.type) {
    case "tool-choose": {
      return part.input?.question?.trim() || undefined;
    }
    case "tool-connect_app":
    case "tool-request_folder": {
      return part.input?.reason?.trim() || undefined;
    }
    default: {
      return undefined;
    }
  }
}

/** The last name on a path, which is how a row calls a file. */
function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

/** When a tool call happened: when it ended, or when the model asked for it. */
function calledAt(part: SessionMessagePart.ToolPart): number {
  const { endedAt } = part.metadata;
  return (
    endedAt instanceof Date ? endedAt : part.metadata.createdAt
  ).getTime();
}

/** Every entry one message yields, in the order the message says them. */
function entriesIn(
  message: SessionMessage.WithParts,
  thread: ActivityEntry["thread"],
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const counts = new Map<Kind, number>();
  const emit = (entry: Omit<ActivityEntry, "id" | "thread">) => {
    const index = counts.get(entry.kind) ?? 0;
    counts.set(entry.kind, index + 1);
    entries.push({
      ...entry,
      id: `${thread.id}:${message.id}:${entry.kind}${index > 0 ? `:${index}` : ""}`,
      thread,
    });
  };
  const createdAt = message.metadata.createdAt.getTime();

  if (message.role === "user") {
    // A wake note is a user message too, with only the event on it; what the
    // user typed is the message with words.
    if (hasWords(message)) {
      emit({ at: createdAt, kind: "asked", text: firstLine(textOf(message)) });
    }
    for (const part of message.parts) {
      if (part.type !== "data-taskEvent") {
        continue;
      }
      for (const event of part.data.events) {
        emit({
          at: createdAt,
          kind:
            event.status === "done"
              ? "taskFinished"
              : event.status === "error"
                ? "taskFailed"
                : "taskOverdue",
          ...(event.files?.length ? { marks: { files: event.files } } : {}),
          taskId: event.taskId,
          text: event.title,
        });
      }
    }
    return entries;
  }
  if (message.role !== "assistant") {
    return entries;
  }

  const finishedAt = message.metadata.finishedAt?.getTime();
  // The files a reply hands over ride on the reply's own row as its marks;
  // they get rows of their own only when there is no reply to carry them.
  const files = [...pathsNamedInMessage(message)];
  const replied = finishedAt !== undefined && hasWords(message);
  if (replied) {
    emit({
      at: finishedAt,
      kind: "replied",
      ...(files.length > 0 ? { marks: { files } } : {}),
      text: firstLine(textOf(message)),
    });
  }
  for (const part of message.parts) {
    if (!isToolPart(part)) {
      continue;
    }
    const at = calledAt(part);
    const command = bashCommandOf(part);
    if (command !== undefined) {
      const started = startedTaskIn(part, command);
      if (started) {
        emit({ at, kind: "startedTask", ...started });
      }
      for (const slug of appSlugsIn(command)) {
        emit({ at, kind: "usedApp", marks: { apps: [slug] }, text: slug });
      }
      for (const host of openedHostsIn(command)) {
        emit({ at, kind: "openedPage", marks: { sites: [host] }, text: host });
      }
      continue;
    }
    const asked = askedIn(part);
    if (asked) {
      emit({ at, kind: "askedYou", text: firstLine(asked) });
    }
  }
  if (!replied) {
    for (const path of files) {
      emit({
        at: finishedAt ?? createdAt,
        kind: "madeFile",
        marks: { files: [path] },
        text: basename(path),
      });
    }
  }
  return entries;
}

async function entriesOf(
  taskId: TaskId,
  session: Session.Type,
): Promise<ActivityEntry[]> {
  const read = await Store.getMessagesWithParts({
    sessionId: session.id,
    taskId,
  });
  if (read.isErr()) {
    return [];
  }
  const thread: ActivityEntry["thread"] = {
    id: session.id,
    title: session.title,
    topics: session.topics ?? [],
  };
  return alphabetical(read.value, (message) => message.id).flatMap((message) =>
    entriesIn(message, thread),
  );
}

/** The task a `task new` made, once the command has printed that it did. */
function startedTaskIn(
  part: SessionMessagePart.ToolPart,
  command: string,
): undefined | { taskId: TaskId; text: string } {
  if (
    part.type !== "tool-bash" ||
    part.state !== "output-available" ||
    !TASK_NEW.test(command)
  ) {
    return undefined;
  }
  const created = CREATED.exec(part.output.output);
  const id = TaskIdSchema.safeParse(created?.[1]);
  if (!id.success) {
    return undefined;
  }
  return { taskId: id.data, text: created?.[2] || id.data };
}
