import { sort } from "radashi";

import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type TaskId } from "../../schemas/task-id";
import { listThreads } from "./threads";
import { listTopics } from "./topics";

/** How many of the other threads a new thread's agent is told about. */
const THREADS_IN_CONTEXT = 12;

/**
 * What a new thread is told about the others: the ones that moved most
 * recently, newest first, each by its id, its title, its topic names, its
 * latest line, and when it last moved. Read at the moment the thread opens and
 * stored on its root, so the note is the same every time the transcript is
 * rebuilt.
 */
export async function threadContextFor(
  taskId: TaskId,
): Promise<SessionMessageDataPart.ThreadContextDataPart> {
  const [threads, topics] = await Promise.all([
    listThreads(taskId),
    listTopics(taskId),
  ]);
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  return {
    sentAt: Date.now(),
    threads: sort(threads, (thread) => thread.updatedAt, true)
      .slice(0, THREADS_IN_CONTEXT)
      .map((thread) => ({
        at: thread.updatedAt,
        id: thread.id,
        ...(thread.latest ? { latest: thread.latest.text } : {}),
        title: thread.title,
        topics: thread.topics.flatMap((id) => {
          const name = names.get(id);
          return name ? [name] : [];
        }),
      })),
  };
}
