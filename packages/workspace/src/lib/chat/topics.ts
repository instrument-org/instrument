import fs from "node:fs";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import { validateFolderName } from "../project-folder-name";
import { getWorkspaceConfig } from "../workspace-config";
import {
  parseTopicFile,
  renderTopicFile,
  TOPIC_FILE_NAME,
  TopicFileSchema,
  type TopicFolder,
  TOPICS_FOLDER_NAME,
  toTheSecond,
} from "./topic-file";

const ulid = monotonicFactory();

const TOPIC_ID_PREFIX = "top_";

/** How long a topic's name may be. Short names keep the marks readable. */
export const TOPIC_NAME_MAX = 24;

export {
  TOPIC_FILE_NAME,
  type TopicFolder,
  TopicFolderSchema,
  TOPICS_FOLDER_NAME,
} from "./topic-file";

/**
 * A topic: a tag on chats, with a folder of its own in the workspace's
 * `Topics/` named for it, holding the `TOPIC.md` that is the topic. Its
 * instructions are the standing words every chat filed under it is read
 * with.
 */
export const TopicSchema = TopicFileSchema.extend({
  name: z.string(),
});

export type Topic = z.output<typeof TopicSchema>;

/** What the user picks about a topic. Anything left out is left alone. */
export interface TopicChange {
  about?: string;
  color?: string;
  emoji?: string;
  folders?: TopicFolder[];
  /** Empty takes them away. */
  instructions?: string;
  name?: string;
}

/** A name a topic's folder cannot take, said to the person who typed it. */
export class TopicNameError extends Error {}

/**
 * Makes a topic and returns it. A name already in use returns that topic
 * instead, since its folder is its name; one retired under that name comes
 * back, with the instructions and folders it had.
 */
export function createTopic(topic: {
  about?: string;
  color?: string;
  emoji?: string;
  name: string;
}): Promise<Topic> {
  return Promise.resolve().then(() => createTopicNow(topic));
}

/**
 * Every topic: the ones in use first, in the order they were made, then the
 * retired ones after, so a menu can stop at the first retired entry and a row
 * can still name a topic the chat was tagged with before it was retired.
 */
export function listTopics(): Promise<Topic[]> {
  return Promise.resolve().then(() =>
    readTopicsSync(getWorkspaceConfig().rootDir),
  );
}

/** A new topic's id: stable across renames, which move its folder. */
export function newTopicId(at?: number): string {
  return `${TOPIC_ID_PREFIX}${ulid(at)}`;
}

/**
 * Every topic under a workspace root, in list order. Synchronous and
 * file-level, for the boot migrations that write topics before the workspace
 * is up, and for everything else, since a topic is one small file.
 */
export function readTopicsSync(rootDir: string): Topic[] {
  const dir = topicsDirOf(rootDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const topics = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) => {
      const topic = readTopicFolder(path.join(dir, entry.name));
      return topic ? [topic] : [];
    })
    .sort(
      (a, b) =>
        a.created.getTime() - b.created.getTime() || a.id.localeCompare(b.id),
    );
  return [
    ...topics.filter((topic) => !topic.retired),
    ...topics.filter((topic) => topic.retired),
  ];
}

/**
 * Takes a topic out of the menus. The chats that carry it keep it, since
 * they were about that subject when they were filed and still are.
 */
export function retireTopic(topicId: string): Promise<void> {
  return Promise.resolve().then(() => {
    retireTopicNow(topicId);
  });
}

/** What a name becomes: no hash, one space between words, bounded. */
export function topicName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, TOPIC_NAME_MAX)
    .trim();
}

/**
 * Where every topic's folder is: `Topics/` at the top level of the folder
 * the person picked, so they can read a topic, change one, or rename one in
 * a file manager.
 *
 * Builds before this kept it in the workspace's hidden `.instrument/`;
 * `moveTopicsToFolder` brings it out once, at launch.
 */
export function topicsDir(): AbsolutePath {
  return AbsolutePathSchema.parse(topicsDirOf(getWorkspaceConfig().rootDir));
}

/**
 * The name a new topic from elsewhere can take: its own, made safe for a
 * folder, or with a number after it when another topic has that name.
 */
export function unusedTopicName(raw: string, taken: readonly string[]): string {
  const base = topicFolderName(raw);
  const keys = new Set(taken.map(nameKey));
  if (!keys.has(nameKey(base))) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, TOPIC_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!keys.has(nameKey(name))) {
      return name;
    }
  }
}

/**
 * Changes what the user chose about a topic. A new name moves the topic's
 * folder, and one another topic has, or one no folder can take, is refused
 * with a `TopicNameError`; anything left out is left alone.
 */
export function updateTopic(
  topicId: string,
  change: TopicChange,
): Promise<void> {
  return Promise.resolve().then(() => {
    updateTopicNow(topicId, change);
  });
}

/**
 * Writes a topic whole into the `TOPIC.md` in the folder named for it, making
 * the folder the first time. The name is the caller's to have made unique and
 * safe. A key this build does not know rides along on the topic's `others`,
 * read off the file it came from, so a round trip through the app keeps what
 * another client wrote.
 */
export function writeTopicSync(rootDir: string, topic: Topic): void {
  const { name, ...file } = topic;
  const folder = path.join(topicsDirOf(rootDir), name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, TOPIC_FILE_NAME),
    renderTopicFile(file),
    "utf8",
  );
}

/** A name the person typed, or a `TopicNameError` saying why a folder cannot take it. */
function checkedTopicName(raw: string): string {
  const name = topicName(raw);
  if (name.startsWith(".")) {
    throw new TopicNameError("Topic name can't start with a period");
  }
  const checked = validateFolderName(name, "Topic");
  if (checked.isErr()) {
    throw new TopicNameError(checked.error.message);
  }
  return checked.value;
}

function createTopicNow({
  about,
  color,
  emoji,
  name,
}: {
  about?: string;
  color?: string;
  emoji?: string;
  name: string;
}): Topic {
  const rootDir = getWorkspaceConfig().rootDir;
  const wanted = checkedTopicName(name);
  const existing = readTopicsSync(rootDir).find(
    (topic) => nameKey(topic.name) === nameKey(wanted),
  );
  if (existing) {
    if (!existing.retired) {
      return existing;
    }
    const { retired: _retired, ...revived } = existing;
    const topic = {
      ...revived,
      ...(about ? { about } : {}),
      ...(color ? { color } : {}),
      ...(emoji ? { emoji } : {}),
    };
    writeTopicSync(rootDir, topic);
    return topic;
  }
  const topic: Topic = {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(new Date()),
    ...(emoji ? { emoji } : {}),
    id: newTopicId(),
    name: wanted,
  };
  writeTopicSync(rootDir, topic);
  return topic;
}

function nameKey(name: string): string {
  return topicName(name).toLowerCase();
}

/**
 * One topic by its folder, or nothing for a folder whose `TOPIC.md` is not
 * there or names no topic. The name is the folder's, so a folder renamed in a
 * file manager is a topic renamed.
 */
function readTopicFolder(folderPath: string): Topic | undefined {
  const file = path.join(folderPath, TOPIC_FILE_NAME);
  let topic;
  try {
    // When the file was last written stands in for a `created` it does not
    // hold, which is what a topic the person made by hand has.
    topic = parseTopicFile(fs.readFileSync(file, "utf8"), {
      at: fs.statSync(file).mtime,
    });
  } catch {
    return undefined;
  }
  if (!topic) {
    return undefined;
  }
  return { ...topic, name: path.basename(folderPath) };
}

/** Where every topic's folder is, under a workspace root. */
function topicsDirOf(rootDir: string): string {
  return path.join(rootDir, TOPICS_FOLDER_NAME);
}

function retireTopicNow(topicId: string): void {
  const rootDir = getWorkspaceConfig().rootDir;
  const topic = readTopicsSync(rootDir).find((entry) => entry.id === topicId);
  if (topic) {
    writeTopicSync(rootDir, { ...topic, retired: true });
  }
}

/**
 * A name as a folder can hold it, for names that come from somewhere other
 * than the person typing one (an older topic, a 1.x project): the characters
 * a folder name cannot have become a dash, and a name left with nothing
 * becomes "Topic".
 */
function topicFolderName(raw: string): string {
  const name = topicName(
    raw
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, ""),
  ).replace(/[. ]+$/, "");
  return validateFolderName(name, "Topic").isOk() ? name : "Topic";
}

function updateTopicNow(topicId: string, change: TopicChange): void {
  const rootDir = getWorkspaceConfig().rootDir;
  const topics = readTopicsSync(rootDir);
  const topic = topics.find((entry) => entry.id === topicId);
  if (!topic) {
    return;
  }
  let name = topic.name;
  if (change.name !== undefined) {
    name = checkedTopicName(change.name);
    const clash = topics.find(
      (entry) => entry.id !== topicId && nameKey(entry.name) === nameKey(name),
    );
    if (clash) {
      throw new TopicNameError(
        `There is already a topic called “${clash.name}”`,
      );
    }
    if (name !== topic.name) {
      const dir = topicsDirOf(rootDir);
      fs.renameSync(path.join(dir, topic.name), path.join(dir, name));
    }
  }
  const { instructions, ...rest } = topic;
  const nextInstructions =
    change.instructions === undefined
      ? instructions
      : change.instructions.trim();
  writeTopicSync(rootDir, {
    ...rest,
    ...(change.about === undefined ? {} : { about: change.about }),
    ...(change.color === undefined ? {} : { color: change.color }),
    ...(change.emoji === undefined ? {} : { emoji: change.emoji }),
    ...(change.folders === undefined ? {} : { folders: change.folders }),
    ...(nextInstructions ? { instructions: nextInstructions } : {}),
    name,
  });
}
