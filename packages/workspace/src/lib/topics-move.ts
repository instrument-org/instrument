import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import {
  parseTopicFile,
  renderTopicFile,
  TOPIC_FILE_NAME,
  type TopicFile,
  topicFileOf,
  TOPICS_FOLDER_NAME,
} from "./chat/topic-file";
import { type FolderMoved, moveOutOfDataDir } from "./move-out-of-data-dir";
import { isRecord } from "./skills";
import { workspaceLayout } from "./workspace-layout";

export type TopicsMoved = FolderMoved;

/** Where a topic's standing words were, in a file of their own. */
const INSTRUCTIONS_FILE_NAME = "instructions.md";

/**
 * Brings the topics an earlier build hid in the workspace's `.instrument/`
 * out to `Topics/` at its top level; see {@link moveOutOfDataDir} for the
 * rules every one of these moves keeps.
 *
 * The folder alone is moved here. What is in each topic folder is still the
 * two hidden files an earlier build wrote, which
 * {@link convertTopicsToTopicFiles} turns into the one `TOPIC.md` a person
 * reads, and which it does whether this move had anything to move or not.
 */
export function moveTopicsToFolder(rootDir: string): Promise<TopicsMoved> {
  return moveOutOfDataDir({
    from: workspaceLayout(rootDir).topicsDir,
    name: TOPICS_FOLDER_NAME,
    rootDir,
  });
}

/** What the conversion came to, for the boot log. */
export interface TopicFilesConverted {
  /** A line per topic converted. */
  done: string[];
  /** Each topic folder left as it was, with why. */
  left: { reason: string; where: string }[];
}

/**
 * Turns each topic's two hidden files into the one file the person opens: a
 * `.instrument/settings.json` and an `instructions.md` in `Topics/<Name>/`
 * become the front matter and the body of a `TOPIC.md` beside them.
 *
 * Safe to run again: a folder that already holds a `TOPIC.md` is left alone,
 * and so is one holding no settings, which is a folder of the person's that
 * was never a topic. The old files go only once the new one has been written
 * and read back as the topic it was written from, so a conversion that fails
 * halfway leaves a readable topic behind either way.
 */
export async function convertTopicsToTopicFiles(
  rootDir: string,
): Promise<TopicFilesConverted> {
  const converted: TopicFilesConverted = { done: [], left: [] };
  const dir = path.join(rootDir, TOPICS_FOLDER_NAME);
  let names: string[];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return converted;
  }
  for (const name of names.toSorted()) {
    const folder = path.join(dir, name);
    try {
      const line = await convertTopicFolder(folder);
      if (line) {
        converted.done.push(line);
      }
    } catch (error) {
      converted.left.push({ reason: String(error), where: folder });
    }
  }
  return converted;
}

/**
 * One topic folder as a `TOPIC.md`, and the line that says so; nothing for a
 * folder there was nothing to do to.
 */
async function convertTopicFolder(folder: string): Promise<string | undefined> {
  const file = path.join(folder, TOPIC_FILE_NAME);
  const already = await fs
    .access(file)
    .then(() => true)
    .catch(() => false);
  if (already) {
    return undefined;
  }
  const hidden = path.join(folder, PRIVATE_FOLDER_NAME);
  const settings = await readRecord(path.join(hidden, SETTINGS_FILE_NAME));
  if (!settings) {
    return undefined;
  }
  const instructionsFile = path.join(folder, INSTRUCTIONS_FILE_NAME);
  const instructions = await fs
    .readFile(instructionsFile, "utf8")
    .catch(() => "");
  const topic = topicOf({ instructions, settings });
  if (!topic) {
    throw new Error(`${SETTINGS_FILE_NAME} names no topic`);
  }
  await fs.writeFile(file, renderTopicFile(topic), "utf8");
  const again = parseTopicFile(await fs.readFile(file, "utf8"), {
    at: new Date(),
  });
  if (again?.id !== topic.id) {
    throw new Error(`${TOPIC_FILE_NAME} did not read back as the topic`);
  }
  await fs.rm(instructionsFile, { force: true });
  await fs.rm(hidden, { force: true, recursive: true });
  return `converted ${path.basename(folder)} to ${TOPIC_FILE_NAME}`;
}

/**
 * The topic the two old files held. The settings are read as the front matter
 * they become, which carries a key this build does not know across with them
 * and takes `createdAt` under the name every visible file uses.
 */
function topicOf({
  instructions,
  settings,
}: {
  instructions: string;
  settings: Record<string, unknown>;
}): TopicFile | undefined {
  const { createdAt, ...rest } = settings;
  return topicFileOf(
    { ...rest, ...(createdAt === undefined ? {} : { created: createdAt }) },
    { at: new Date(), instructions },
  );
}

/** What a settings file holds, or nothing where there is no readable one. */
async function readRecord(
  file: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
