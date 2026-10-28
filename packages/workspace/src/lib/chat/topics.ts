import fs from "node:fs";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import {
  everyTopicsFolderPaths,
  setTopicFolders,
} from "../permissions/topic-folders";
import { validateFolderName } from "../project-folder-name";
import { rewriteFileSync } from "../rewrite-file";
import { getWorkspaceConfig } from "../workspace-config";
import {
  parseTopicFile,
  renderTopicFile,
  TOPIC_FILE_NAME,
  TopicFileSchema,
  TOPICS_FOLDER_NAME,
  toTheSecond,
} from "./topic-file";

const ulid = monotonicFactory();

const TOPIC_ID_PREFIX = "top_";

/** How long a topic's name may be. Short names keep the marks readable. */
export const TOPIC_NAME_MAX = 24;

export { TOPIC_FILE_NAME, TOPICS_FOLDER_NAME } from "./topic-file";

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

/** A folder of the user's that work under a topic uses, by its path on disk. */
export const TopicFolderSchema = z.object({ path: z.string() });

export type TopicFolder = z.output<typeof TopicFolderSchema>;

/**
 * A topic as the app lists it: its file, and the folders granted under it on
 * this computer, which are kept in its permission settings rather than in the
 * file.
 */
export const ListedTopicSchema = TopicSchema.extend({
  folders: z.array(TopicFolderSchema).optional(),
});

export type ListedTopic = z.output<typeof ListedTopicSchema>;

/** What the user picks about a topic. Anything left out is left alone. */
export interface TopicChange {
  about?: string;
  color?: string;
  emoji?: string;
  folders?: TopicFolder[];
  /** Empty takes it away. */
  icon?: string;
  /** Empty takes them away. */
  instructions?: string;
  name?: string;
}

/** A name a topic's folder cannot take, said to the person who typed it. */
export class TopicNameError extends Error {}

/**
 * Makes a topic and returns it, with its instructions and the folders granted
 * under it on this computer. A name already in use returns that topic as it
 * is instead, since its folder is its name, and is refused with a
 * `TopicNameError` when instructions or folders were given, which would
 * otherwise be dropped without a word; one retired under that name comes
 * back, with the instructions and folders it had unless new ones are given.
 * A grant that fails takes back the topic it was for, so no topic is left
 * made without the folders it was made with.
 */
export async function createTopic({
  folders = [],
  ...topic
}: {
  about?: string;
  color?: string;
  emoji?: string;
  folders?: TopicFolder[];
  icon?: string;
  instructions?: string;
  name: string;
}): Promise<Topic> {
  const made = await Promise.resolve().then(() => createTopicNow(topic));
  if (
    made.was === "in use" &&
    (folders.length > 0 || Boolean(topic.instructions?.trim()))
  ) {
    throw new TopicNameError(
      `There is already a topic called “${made.topic.name}”`,
    );
  }
  if (made.was === "in use" || folders.length === 0) {
    return made.topic;
  }
  try {
    await setTopicFolders(
      made.topic.id,
      folders.map((folder) => folder.path),
    );
  } catch (error) {
    takeBackTopic(made);
    throw error;
  }
  return made.topic;
}

/**
 * Every topic: the ones in use first, in the order they were made, then the
 * retired ones after, so a menu can stop at the first retired entry and a row
 * can still name a topic the chat was tagged with before it was retired. Each
 * with the folders granted under it on this computer.
 */
export async function listTopics(): Promise<ListedTopic[]> {
  const topics = readTopicsSync(getWorkspaceConfig().rootDir);
  const granted = await everyTopicsFolderPaths();
  return topics.map((topic) => {
    const paths = granted.get(topic.id) ?? [];
    return paths.length > 0
      ? { ...topic, folders: paths.map((each) => ({ path: each })) }
      : topic;
  });
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
 * with a `TopicNameError`; anything left out is left alone. Its folders are
 * granted on this computer, in its permission settings.
 */
export async function updateTopic(
  topicId: string,
  change: TopicChange,
): Promise<void> {
  const found = await Promise.resolve().then(() =>
    updateTopicNow(topicId, change),
  );
  if (found && change.folders !== undefined) {
    await setTopicFolders(
      topicId,
      change.folders.map((folder) => folder.path),
    );
  }
}

/**
 * Writes a topic whole into the `TOPIC.md` in the folder named for it, making
 * the folder the first time. The name is the caller's to have made unique and
 * safe. A key this build does not know rides along on the topic's `others`,
 * read off the file it came from, so a round trip through the app keeps what
 * another client wrote.
 */
export function writeTopicSync(rootDir: string, topic: Topic): Topic {
  return rewriteTopicSync(rootDir, topic, () => topic);
}

/**
 * Applies `change` to the topic as its `TOPIC.md` holds it at the moment of
 * writing, so a change to its front matter keeps instructions the person
 * edited since the topic was read, and answers with what was written. `topic`
 * stands in where the file is gone or names another topic.
 */
function rewriteTopicSync(
  rootDir: string,
  topic: Topic,
  change: (onDisk: Topic) => Topic,
): Topic {
  let written = topic;
  rewriteFileSync(
    path.join(topicsDirOf(rootDir), topic.name, TOPIC_FILE_NAME),
    (text) => {
      const onDisk =
        text === undefined
          ? undefined
          : parseTopicFile(text, { at: topic.created });
      written = change(
        onDisk?.id === topic.id ? { ...onDisk, name: topic.name } : topic,
      );
      const { name: _name, ...file } = written;
      return renderTopicFile(file);
    },
  );
  return written;
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

/**
 * What `createTopicNow` did: found a topic in use under the name, brought a
 * retired one back (kept as it was, to put back), or made a new one.
 */
type MadeTopic =
  | { retired: Topic; topic: Topic; was: "retired" }
  | { topic: Topic; was: "in use" | "new" };

function createTopicNow({
  about,
  color,
  emoji,
  icon,
  instructions: given,
  name,
}: {
  about?: string;
  color?: string;
  emoji?: string;
  icon?: string;
  instructions?: string;
  name: string;
}): MadeTopic {
  const rootDir = getWorkspaceConfig().rootDir;
  const wanted = checkedTopicName(name);
  const instructions = given?.trim();
  const existing = readTopicsSync(rootDir).find(
    (topic) => nameKey(topic.name) === nameKey(wanted),
  );
  if (existing) {
    if (!existing.retired) {
      return { topic: existing, was: "in use" };
    }
    const topic = rewriteTopicSync(rootDir, existing, (current) => {
      const { retired: _retired, ...revived } = current;
      return {
        ...revived,
        ...(about ? { about } : {}),
        ...(color ? { color } : {}),
        ...(emoji ? { emoji } : {}),
        ...(icon ? { icon } : {}),
        ...(instructions ? { instructions } : {}),
      };
    });
    return { retired: existing, topic, was: "retired" };
  }
  const topic: Topic = {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(new Date()),
    ...(emoji ? { emoji } : {}),
    ...(icon ? { icon } : {}),
    id: newTopicId(),
    ...(instructions ? { instructions } : {}),
    name: wanted,
  };
  return { topic: writeTopicSync(rootDir, topic), was: "new" };
}

/**
 * Puts back what `createTopicNow` changed: a retired topic retired again as
 * it was, or a new one's file gone, with its folder when nothing else is in
 * it, since a folder of the person's can stand where the topic was made.
 */
function takeBackTopic(made: MadeTopic): void {
  const rootDir = getWorkspaceConfig().rootDir;
  if (made.was === "retired") {
    writeTopicSync(rootDir, made.retired);
    return;
  }
  if (made.was === "new") {
    const folder = path.join(topicsDirOf(rootDir), made.topic.name);
    fs.rmSync(path.join(folder, TOPIC_FILE_NAME), { force: true });
    try {
      fs.rmdirSync(folder);
    } catch {
      // Something of the person's is in it, so the folder stays.
    }
  }
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
    rewriteTopicSync(rootDir, topic, (current) => ({
      ...current,
      retired: true,
    }));
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

/** Writes the change to the topic's file; false for a topic not there. */
function updateTopicNow(topicId: string, change: TopicChange): boolean {
  const rootDir = getWorkspaceConfig().rootDir;
  const topics = readTopicsSync(rootDir);
  const topic = topics.find((entry) => entry.id === topicId);
  if (!topic) {
    return false;
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
  rewriteTopicSync(rootDir, { ...topic, name }, (current) => {
    const { emoji, icon, instructions, ...rest } = current;
    const nextInstructions =
      change.instructions === undefined
        ? instructions
        : change.instructions.trim();
    // A mark is one or the other, so choosing one sends the other empty,
    // which leaves no line for it in the file.
    const nextEmoji = change.emoji ?? emoji;
    const nextIcon = change.icon ?? icon;
    return {
      ...rest,
      ...(change.about === undefined ? {} : { about: change.about }),
      ...(change.color === undefined ? {} : { color: change.color }),
      ...(nextEmoji ? { emoji: nextEmoji } : {}),
      ...(nextIcon ? { icon: nextIcon } : {}),
      ...(nextInstructions ? { instructions: nextInstructions } : {}),
    };
  });
  return true;
}
