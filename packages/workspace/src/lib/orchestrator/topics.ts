import fs from "node:fs/promises";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { TOPICS_DIR_NAME } from "../../constants";
import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { isRecord, splitFrontmatter } from "../skills";
import { getWorkspaceConfig } from "../workspace-config";

const ulid = monotonicFactory();

const TOPIC_ID_PREFIX = "top_";
const TOPIC_FILE_NAME = "topic.md";

/** How long a topic's name may be. Short names keep the marks readable. */
export const TOPIC_NAME_MAX = 24;

/**
 * A topic as its file holds it. The front matter is what the window shows
 * and the body is its instructions, the standing words every chat filed under
 * it is read with.
 */
export const TopicSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on, as a hex string. */
  color: z.string().optional(),
  createdAt: z.number(),
  /** What stands for it: one emoji, chosen when it was made. */
  emoji: z.string().optional(),
  id: z.string(),
  /** The standing words for work under it; empty for most topics. */
  instructions: z.string().optional(),
  name: z.string(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.boolean().optional(),
});

export type Topic = z.output<typeof TopicSchema>;

/** What the user picks about a topic: its name, its mark, its tint. */
export interface TopicChange {
  about?: string;
  color?: string;
  emoji?: string;
  name?: string;
}

/** Makes a topic and returns it. */
export async function createTopic({
  about,
  color,
  emoji,
  name,
}: {
  about?: string;
  color?: string;
  emoji?: string;
  name: string;
}): Promise<Topic> {
  const topic: Topic = {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    createdAt: Date.now(),
    ...(emoji ? { emoji } : {}),
    id: `${TOPIC_ID_PREFIX}${ulid()}`,
    name: topicName(name),
  };
  await writeTopic(topic);
  return topic;
}

/**
 * Every topic: the ones in use first, in the order they were made, then the
 * retired ones after, so a menu can stop at the first retired entry and a row
 * can still name a topic the chat was tagged with before it was retired.
 */
export async function listTopics(): Promise<Topic[]> {
  let entries;
  try {
    entries = await fs.readdir(topicsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const read = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => readTopic(entry.name)),
  );
  const topics = read
    .flatMap((topic) => (topic ? [topic] : []))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return [
    ...topics.filter((topic) => !topic.retired),
    ...topics.filter((topic) => topic.retired),
  ];
}

/**
 * Takes a topic out of the menus. The chats that carry it keep it, since
 * they were about that subject when they were filed and still are.
 */
export async function retireTopic(topicId: string): Promise<void> {
  await changeTopic(topicId, (topic) => ({ ...topic, retired: true }));
}

/** A topic in use by name, however the caller cased or hashed it. */
export async function topicByName(name: string): Promise<Topic | undefined> {
  // Case-insensitive, since a name is written by the user and typed back by
  // the agent, and neither should have to remember which.
  const wanted = topicName(name).toLowerCase();
  const topics = await listTopics();
  return topics.find(
    (topic) => !topic.retired && topic.name.toLowerCase() === wanted,
  );
}

/** A topic's own folder: its file, and later whatever it keeps for reference. */
export function topicDir(topicId: string): AbsolutePath {
  return absolutePathJoin(topicsDir(), topicId);
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

/** Where every topic's folder is. */
export function topicsDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, TOPICS_DIR_NAME);
}

/**
 * Changes what the user chose about a topic. All of it is the user's, so
 * nothing here judges it beyond the shape every name takes; anything left out
 * is left alone.
 */
export async function updateTopic(
  topicId: string,
  change: TopicChange,
): Promise<void> {
  await changeTopic(topicId, (topic) => ({
    ...topic,
    ...(change.about === undefined ? {} : { about: change.about }),
    ...(change.color === undefined ? {} : { color: change.color }),
    ...(change.emoji === undefined ? {} : { emoji: change.emoji }),
    ...(change.name === undefined ? {} : { name: topicName(change.name) }),
  }));
}

/** Writes a topic's file whole, making its folder the first time. */
export async function writeTopic(topic: Topic): Promise<void> {
  const dir = topicDir(topic.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, TOPIC_FILE_NAME), serialize(topic), "utf8");
}

async function changeTopic(
  topicId: string,
  change: (topic: Topic) => Topic,
): Promise<void> {
  const topic = await readTopic(topicId);
  if (!topic) {
    return;
  }
  await writeTopic(change(topic));
}

/**
 * One topic by the name of its folder, or nothing for a folder with no
 * readable file. A body the user wrote by hand with no front matter is still
 * the topic's instructions, named by its folder.
 */
async function readTopic(folder: string): Promise<Topic | undefined> {
  if (!folder.startsWith(TOPIC_ID_PREFIX)) {
    return undefined;
  }
  let raw: string;
  let modifiedAt: number;
  try {
    const filePath = path.join(topicsDir(), folder, TOPIC_FILE_NAME);
    [raw, modifiedAt] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath).then((stat) => stat.mtimeMs),
    ]);
  } catch {
    return undefined;
  }
  const split = splitFrontmatter(raw);
  let data: unknown = {};
  if (split.ok) {
    try {
      data = parseYaml(split.block) as unknown;
    } catch {
      data = {};
    }
  }
  const record = isRecord(data) ? data : {};
  const instructions = (split.ok ? split.body : raw).trim();
  const text = (key: string) =>
    typeof record[key] === "string" && record[key].trim()
      ? record[key].trim()
      : undefined;
  const created = text("created");
  const about = text("about");
  const color = text("color");
  const emoji = text("emoji");
  return {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    createdAt:
      created && !Number.isNaN(Date.parse(created))
        ? Date.parse(created)
        : modifiedAt,
    ...(emoji ? { emoji } : {}),
    id: folder,
    ...(instructions ? { instructions } : {}),
    name: topicName(text("name") ?? folder),
    ...(record.retired === true ? { retired: true } : {}),
  };
}

/**
 * The file: front matter for what the window shows, then the instructions.
 * String values are written as JSON, which YAML reads as a quoted scalar, so
 * a name holding a colon or a quote round-trips.
 */
function serialize(topic: Topic): string {
  const lines = ["---", `name: ${JSON.stringify(topic.name)}`];
  if (topic.emoji) {
    lines.push(`emoji: ${JSON.stringify(topic.emoji)}`);
  }
  if (topic.color) {
    lines.push(`color: ${JSON.stringify(topic.color)}`);
  }
  if (topic.about) {
    lines.push(`about: ${JSON.stringify(topic.about)}`);
  }
  if (topic.retired) {
    lines.push("retired: true");
  }
  lines.push(`created: ${new Date(topic.createdAt).toISOString()}`, "---");
  if (topic.instructions) {
    lines.push(topic.instructions.trim());
  }
  lines.push("");
  return lines.join("\n");
}
