import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import {
  parseProjectFile,
  renderProjectFile,
  PROJECT_FILE_NAME,
  type ProjectFile,
  projectFileOf,
  PROJECTS_FOLDER_NAME,
} from "./chat/project-file";
import { type FolderMoved, moveOutOfDataDir } from "./move-out-of-data-dir";
import { readOldFile } from "./read-old-file";
import { rewriteFileSync } from "./rewrite-file";
import { isSystemClutter } from "./system-clutter";
import { isRecord } from "./skills";
import { workspaceLayout } from "./workspace-layout";

export type ProjectsMoved = FolderMoved;

/** Where a project's standing words were, in a file of their own. */
const INSTRUCTIONS_FILE_NAME = "instructions.md";

/**
 * Brings the projects an earlier build hid in the workspace's `.instrument/`
 * out to `Projects/` at its top level; see {@link moveOutOfDataDir} for the
 * rules every one of these moves keeps.
 *
 * The folder alone is moved here. What is in each project folder is still the
 * two hidden files an earlier build wrote, which
 * {@link convertProjectsToProjectFiles} turns into the one `AGENTS.md` a person
 * reads, and which it does whether this move had anything to move or not.
 */
export function moveProjectsToFolder(rootDir: string): Promise<ProjectsMoved> {
  return moveOutOfDataDir({
    from: workspaceLayout(rootDir).topicsDir,
    name: PROJECTS_FOLDER_NAME,
    rootDir,
  });
}

/** What the conversion came to, for the boot log. */
export interface ProjectFilesConverted {
  /** A line per project converted. */
  done: string[];
  /** Each project folder left as it was, with why. */
  left: { reason: string; where: string }[];
}

/**
 * Turns each project's two hidden files into the one file the person opens: a
 * `.instrument/settings.json` and an `instructions.md` in `Projects/<Name>/`
 * become the front matter and the body of an `AGENTS.md` beside them.
 *
 * Safe to run again: a folder that already holds an `AGENTS.md` is left alone,
 * and so is one holding no settings, which is a folder of the person's that
 * was never a project. The old files go only once the new one has been written
 * and read back as the project it was written from, so a conversion that fails
 * halfway leaves a readable project behind either way.
 */
export async function convertProjectsToProjectFiles(
  rootDir: string,
): Promise<ProjectFilesConverted> {
  const converted: ProjectFilesConverted = { done: [], left: [] };
  const dir = path.join(rootDir, PROJECTS_FOLDER_NAME);
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
      const line = await convertProjectFolder(folder);
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
 * One project folder as an `AGENTS.md`, and the line that says so; nothing for a
 * folder there was nothing to do to.
 */
async function convertProjectFolder(
  folder: string,
): Promise<string | undefined> {
  const file = path.join(folder, PROJECT_FILE_NAME);
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
  const instructions = (await readOldFile(instructionsFile)) ?? "";
  const project = projectOf({ instructions, settings });
  if (!project) {
    throw new Error(`${SETTINGS_FILE_NAME} names no project`);
  }
  // Whole or not at all: a file cut short would read as the project
  // converted, and the two files it came from would never be read again.
  rewriteFileSync(file, () => renderProjectFile(project));
  const again = parseProjectFile(await fs.readFile(file, "utf8"), {
    at: new Date(),
  });
  if (again?.id !== project.id) {
    throw new Error(`${PROJECT_FILE_NAME} did not read back as the project`);
  }
  await fs.rm(instructionsFile, { force: true });
  await fs.rm(hidden, { force: true, recursive: true });
  return `converted ${path.basename(folder)} to ${PROJECT_FILE_NAME}`;
}

/**
 * The project the two old files held. The settings are read as the front matter
 * they become, which carries a key this build does not know across with them
 * and takes `createdAt` under the name every visible file uses.
 */
function projectOf({
  instructions,
  settings,
}: {
  instructions: string;
  settings: Record<string, unknown>;
}): ProjectFile | undefined {
  const { createdAt, ...rest } = settings;
  return projectFileOf(
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

/** Where builds that called projects topics kept them, and each one's file. */
const TOPICS_FOLDER_NAME = "Topics";
const TOPIC_FILE_NAME = "TOPIC.md";

/**
 * Brings the projects a build that called them topics kept in `Topics/` into
 * `Projects/`, each `TOPIC.md` becoming the project's `AGENTS.md`. The folder
 * is renamed whole when `Projects/` is not there yet, and otherwise moved in
 * a project at a time, one whose name is taken staying in `Topics/` for the
 * person to settle. A folder holding both files keeps both, and is named in
 * `left`. Safe to run on every launch: with no `Topics/` and no `TOPIC.md`
 * left it reads one folder and does nothing.
 */
export async function moveTopicsToProjects(
  rootDir: string,
): Promise<ProjectFilesConverted> {
  const moved: ProjectFilesConverted = { done: [], left: [] };
  const topics = path.join(rootDir, TOPICS_FOLDER_NAME);
  const projects = path.join(rootDir, PROJECTS_FOLDER_NAME);
  const names: string[] = await fs.readdir(rootDir).catch(() => []);
  if (names.includes(TOPICS_FOLDER_NAME)) {
    // Asked of the disk rather than the listing, which spells it `projects/`
    // on a disk that doesn't tell the two apart, where a rename onto it fails.
    const hasProjects = await fs
      .lstat(projects)
      .then(() => true)
      .catch(() => false);
    if (hasProjects) {
      const inTopics = (await fs.readdir(topics)).filter(
        (name) => !isSystemClutter(name),
      );
      for (const name of inTopics) {
        const to = path.join(projects, name);
        const taken = await fs
          .lstat(to)
          .then(() => true)
          .catch(() => false);
        if (taken) {
          moved.left.push({
            reason: `${PROJECTS_FOLDER_NAME}/ already has a ${name}`,
            where: path.join(topics, name),
          });
          continue;
        }
        await fs.rename(path.join(topics, name), to);
        moved.done.push(
          `moved ${TOPICS_FOLDER_NAME}/${name} to ${PROJECTS_FOLDER_NAME}/`,
        );
      }
      if (moved.left.length === 0) {
        // Nothing of the person's is left in it, only what the system put there.
        await fs.rm(topics, { force: true, recursive: true });
      }
    } else {
      await fs.rename(topics, projects);
      moved.done.push(
        `moved ${TOPICS_FOLDER_NAME}/ to ${PROJECTS_FOLDER_NAME}/`,
      );
    }
  }
  const folders = await fs
    .readdir(projects, { withFileTypes: true })
    .catch(() => []);
  for (const entry of folders) {
    if (!entry.isDirectory()) {
      continue;
    }
    const from = path.join(projects, entry.name, TOPIC_FILE_NAME);
    const to = path.join(projects, entry.name, PROJECT_FILE_NAME);
    const [hasTopic, hasProject] = await Promise.all(
      [from, to].map((file) =>
        fs
          .access(file)
          .then(() => true)
          .catch(() => false),
      ),
    );
    if (!hasTopic) {
      continue;
    }
    if (hasProject) {
      moved.left.push({
        reason: `it has both a ${TOPIC_FILE_NAME} and an ${PROJECT_FILE_NAME}`,
        where: path.join(projects, entry.name),
      });
      continue;
    }
    await fs.rename(from, to);
    moved.done.push(
      `renamed ${entry.name}/${TOPIC_FILE_NAME} to ${PROJECT_FILE_NAME}`,
    );
  }
  return moved;
}
