import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { TOPICS_DIR_NAME } from "../../constants";
import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { validateFolderName } from "../project-folder-name";
import { getWorkspaceConfig } from "../workspace-config";
import { updateJsonRecordSync } from "../json-record-file";

const ulid = monotonicFactory();

const TOPIC_ID_PREFIX = "top_";
/** The topic's standing words, in a file of its own beside its settings. */
const INSTRUCTIONS_FILE_NAME = "instructions.md";

/** How long a topic's name may be. Short names keep the marks readable. */
export const TOPIC_NAME_MAX = 24;

/** A folder of the user's that work under a topic uses, by its path on disk. */
export const TopicFolderSchema = z.object({ path: z.string() });

export type TopicFolder = z.output<typeof TopicFolderSchema>;

/**
 * What `.instrument/settings.json` in a topic's folder holds: everything the
 * app keeps about it but its name, which is the folder's, and its
 * instructions, which are `instructions.md` beside it.
 */
const TopicSettingsSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on, as a hex string. */
  color: z.string().optional(),
  createdAt: z.number(),
  /** What stands for it: one emoji, chosen when it was made. */
  emoji: z.string().optional(),
  /** The user's folders the work under it uses, attached to each chat it is on. */
  folders: z.array(TopicFolderSchema).optional(),
  id: z.string(),
  /**
   * The 1.x project the migration made it from, or joined to it, so a later
   * boot finds it again by that rather than by a name two projects can share.
   */
  projectId: z.string().optional(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.boolean().optional(),
});

/**
 * A topic: a tag on chats, with a folder of its own under `topics/` named
 * for it. Its instructions are the standing words every chat filed under it
 * is read with.
 */
export const TopicSchema = TopicSettingsSchema.extend({
  /** The standing words for work under it; empty for most topics. */
  instructions: z.string().optional(),
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
 * is up, and for everything else, since a topic is two small files.
 */
export function readTopicsSync(rootDir: string): Topic[] {
  const dir = path.join(rootDir, TOPICS_DIR_NAME);
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
export function retireTopic(topicId: string): Promise<void> {
  return Promise.resolve().then(() => {
    retireTopicNow(topicId);
  });
}

/** A topic in use by name, however the caller cased or hashed it. */
export async function topicByName(name: string): Promise<Topic | undefined> {
  // Case-insensitive, since a name is written by the user and typed back by
  // the agent, and neither should have to remember which. It is also how a
  // Mac compares the folder names.
  const wanted = nameKey(name);
  const topics = await listTopics();
  return topics.find(
    (topic) => !topic.retired && nameKey(topic.name) === wanted,
  );
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

/** Where every topic's folder is. */
export function topicsDir(): AbsolutePath {
  return absolutePathJoin(getWorkspaceConfig().rootDir, TOPICS_DIR_NAME);
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
 * Writes a topic whole into the folder named for it, making the folder the
 * first time: its settings, and its instructions when it has any. The name is
 * the caller's to have made unique and safe. A settings field this build
 * does not know is carried forward, and settings that cannot be read are
 * refused rather than written over.
 */
export function writeTopicSync(rootDir: string, topic: Topic): void {
  const { instructions, name, ...settings } = topic;
  const folder = path.join(rootDir, TOPICS_DIR_NAME, name);
  // Every field this build knows is written as the topic has it, absent ones
  // dropped (a retired topic brought back loses its mark); the rest stay.
  const known = Object.fromEntries(
    Object.keys(TopicSettingsSchema.shape).map((key) => [key, undefined]),
  );
  updateJsonRecordSync(
    path.join(folder, TASK_PRIVATE_FOLDER_NAME, TASK_SETTINGS_FILE_NAME),
    () => ({ ...known, ...TopicSettingsSchema.parse(settings) }),
  );
  const instructionsFile = path.join(folder, INSTRUCTIONS_FILE_NAME);
  if (instructions?.trim()) {
    fs.writeFileSync(instructionsFile, `${instructions.trim()}\n`, "utf8");
  } else {
    fs.rmSync(instructionsFile, { force: true });
  }
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
    createdAt: Date.now(),
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
 * One topic by its folder, or nothing for a folder with no readable settings.
 * The name is the folder's, so a folder renamed in a file manager is a topic
 * renamed.
 */
function readTopicFolder(folderPath: string): Topic | undefined {
  let settings: z.output<typeof TopicSettingsSchema>;
  try {
    settings = TopicSettingsSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(
            folderPath,
            TASK_PRIVATE_FOLDER_NAME,
            TASK_SETTINGS_FILE_NAME,
          ),
          "utf8",
        ),
      ),
    );
  } catch {
    return undefined;
  }
  let instructions = "";
  try {
    instructions = fs
      .readFileSync(path.join(folderPath, INSTRUCTIONS_FILE_NAME), "utf8")
      .trim();
  } catch {
    // Most topics have none.
  }
  return {
    ...settings,
    ...(instructions ? { instructions } : {}),
    name: path.basename(folderPath),
  };
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
      fs.renameSync(
        path.join(rootDir, TOPICS_DIR_NAME, topic.name),
        path.join(rootDir, TOPICS_DIR_NAME, name),
      );
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
