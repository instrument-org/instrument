import { monotonicFactory } from "ulid";

import { type TaskId } from "../../schemas/task-id";
import { type TaskState } from "../../schemas/task-state";
import { taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskTopics } from "../task-record";

const ulid = monotonicFactory();

const TOPIC_ID_PREFIX = "top_";

/** How long a topic's name may be. Short names keep the marks readable. */
export const TOPIC_NAME_MAX = 24;

export type Topic = NonNullable<TaskState["topics"]>[number];

/** What the user picks about a topic: its name, its mark, its tint. */
export interface TopicChange {
  about?: string;
  color?: string;
  emoji?: string;
  name?: string;
}

/** Makes a topic and returns it. */
export async function createTopic(
  taskId: TaskId,
  {
    about,
    color,
    emoji,
    name,
  }: { about?: string; color?: string; emoji?: string; name: string },
): Promise<Topic> {
  const topic: Topic = {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    createdAt: Date.now(),
    ...(emoji ? { emoji } : {}),
    id: `${TOPIC_ID_PREFIX}${ulid()}`,
    name: topicName(name),
  };
  await updateTaskTopics(taskDir(taskId), (topics) => [...topics, topic]);
  return topic;
}

/**
 * The conversation's topics: the ones in use first, in the order they were
 * made, then the retired ones after, so a menu can stop at the first retired
 * entry and a row can still name a topic the thread was tagged with before it
 * was retired.
 */
export async function listTopics(taskId: TaskId): Promise<Topic[]> {
  const state = await getTaskState(taskDir(taskId));
  const topics = state.topics ?? [];
  return [
    ...topics.filter((topic) => !topic.retired),
    ...topics.filter((topic) => topic.retired),
  ];
}

/**
 * Takes a topic out of the menus. The threads that carry it keep it, since
 * they were about that subject when they were filed and still are.
 */
export async function retireTopic(
  taskId: TaskId,
  topicId: string,
): Promise<void> {
  await updateTaskTopics(taskDir(taskId), (topics) =>
    topics.map((topic) =>
      topic.id === topicId ? { ...topic, retired: true } : topic,
    ),
  );
}

/** A topic in use by name, however the caller cased or hashed it. */
export async function topicByName(
  taskId: TaskId,
  name: string,
): Promise<Topic | undefined> {
  // Case-insensitive, since a name is written by the user and typed back by
  // the agent, and neither should have to remember which.
  const wanted = topicName(name).toLowerCase();
  const topics = await listTopics(taskId);
  return topics.find(
    (topic) => !topic.retired && topic.name.toLowerCase() === wanted,
  );
}

/** What a name becomes: no hash, one space between words, bounded. */
export function topicName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, TOPIC_NAME_MAX);
}

/**
 * Changes what the user chose about a topic. All of it is the user's, so
 * nothing here judges it beyond the shape every name takes; anything left out
 * is left alone.
 */
export async function updateTopic(
  taskId: TaskId,
  topicId: string,
  change: TopicChange,
): Promise<void> {
  await updateTaskTopics(taskDir(taskId), (topics) =>
    topics.map((topic) =>
      topic.id === topicId
        ? {
            ...topic,
            ...(change.about === undefined ? {} : { about: change.about }),
            ...(change.color === undefined ? {} : { color: change.color }),
            ...(change.emoji === undefined ? {} : { emoji: change.emoji }),
            ...(change.name === undefined
              ? {}
              : { name: topicName(change.name) }),
          }
        : topic,
    ),
  );
}
