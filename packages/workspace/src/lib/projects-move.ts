import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { type DeviceId } from "../schemas/device-id";
import {
  parseProjectFile,
  PROJECT_FILE_NAME,
  type ProjectFile,
  type ProjectFileRead,
  projectFileOf,
  PROJECTS_FOLDER_NAME,
  renderInstructionsFile,
  withoutFrontMatterKeys,
} from "./chat/project-file";
import {
  type ProjectRecord,
  readProjectRecords,
  writeProjectRecords,
} from "./chat/project-records";
import { readProjectsSync, writeProjectSync } from "./chat/projects";
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
 * Turns each project's two hidden files into what this build reads: a
 * `.instrument/settings.json` in `Projects/<Name>/` becomes the project's
 * record in the projects store, and an `instructions.md` beside it its
 * `AGENTS.md`.
 *
 * Safe to run again: a folder that already holds an `AGENTS.md` is left alone,
 * and so is one holding no settings, which is a folder of the person's that
 * was never a project. The old files go only once the record has been written
 * and read back, so a conversion that fails halfway leaves a readable project
 * behind either way.
 */
export async function convertProjectsToProjectFiles(
  rootDir: string,
  /** The device the records are written as; the running workspace's when left out. */
  device?: DeviceId,
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
      const line = await convertProjectFolder(rootDir, folder, device);
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
  rootDir: string,
  folder: string,
  device: DeviceId | undefined,
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
  const name = path.basename(folder);
  writeProjectSync(rootDir, { ...project, name }, { device, keepWords: true });
  if (!readProjectRecords(rootDir).has(project.id)) {
    throw new Error("its record did not read back as the project");
  }
  // The instructions, under the settings keys this build does not know: the
  // folders an earlier build granted, which the launch takes onto this
  // computer's settings next (`moveProjectFolders`), and anyone else's.
  const words = renderInstructionsFile(project);
  if (words !== "") {
    rewriteFileSync(file, () => words);
  }
  await fs.rm(instructionsFile, { force: true });
  await fs.rm(hidden, { force: true, recursive: true });
  return `converted ${name} to its record`;
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

/**
 * Takes what earlier builds wrote into each project's `AGENTS.md` as front
 * matter (its id, mark, tint, about line, when it was made, whether it was
 * retired, the 1.x project it was joined to) into the projects store, and
 * writes the file back as the person's words alone: the instructions, under
 * any front matter of anyone else's, as it was. A file left with nothing in
 * it is deleted, since a project with no instructions needs none.
 *
 * Every launch, since a build before this one, on another computer sharing
 * the workspace, writes front matter back; a file with none is read and left
 * alone. What a file says is taken as of when the file was last written, so
 * a change made since in the app, on any device, outranks it. Each folder
 * with no record gets one, and the id its front matter named goes into its
 * `.instrument-project` before the front matter comes out, as any read in a
 * running workspace does.
 */
export function settleProjectFiles(
  rootDir: string,
  device: DeviceId,
): ProjectFilesConverted {
  const settled: ProjectFilesConverted = { done: [], left: [] };
  const projects = readProjectsSync(rootDir, { device });
  const records = readProjectRecords(rootDir);
  for (const project of projects) {
    const file = path.join(
      rootDir,
      PROJECTS_FOLDER_NAME,
      project.name,
      PROJECT_FILE_NAME,
    );
    try {
      let text: string;
      let at: Date;
      try {
        // oxlint-disable-next-line studio/no-sync-content-read -- a launch step before the workspace is up, synchronous like the projects' own reads.
        text = fsSync.readFileSync(file, "utf8");
        at = fsSync.statSync(file).mtime;
      } catch {
        continue;
      }
      const stripped = withoutFrontMatterKeys(text);
      if (stripped === undefined) {
        continue;
      }
      const record = records.get(project.id);
      if (record) {
        writeProjectRecords(rootDir, device, [
          {
            at: at.getTime(),
            id: project.id,
            record: absorbed(record, parseProjectFile(text, { at })),
          },
        ]);
      }
      if (!readProjectRecords(rootDir).has(project.id)) {
        throw new Error("its record is not in the projects store");
      }
      if (stripped === "") {
        fsSync.rmSync(file, { force: true });
      } else {
        rewriteFileSync(
          file,
          (current) =>
            (current === undefined
              ? undefined
              : withoutFrontMatterKeys(current)) ??
            current ??
            stripped,
        );
      }
      settled.done.push(
        `took ${project.name}'s front matter into its record${stripped === "" ? `, and removed its empty ${PROJECT_FILE_NAME}` : ""}`,
      );
    } catch (error) {
      settled.left.push({ reason: String(error), where: file });
    }
  }
  return settled;
}

/**
 * A record with what a file's front matter says over it, key by key: only
 * what the file names, and never its id or when it was made, which the
 * record already has. An emoji takes the icon's place, and an icon the
 * emoji's.
 */
function absorbed(record: ProjectRecord, file: ProjectFileRead): ProjectRecord {
  const { emoji, icon, ...rest } = record;
  const mark =
    file.emoji !== undefined || file.icon !== undefined
      ? {
          ...(file.emoji === undefined ? {} : { emoji: file.emoji }),
          ...(file.icon === undefined ? {} : { icon: file.icon }),
        }
      : {
          ...(emoji === undefined ? {} : { emoji }),
          ...(icon === undefined ? {} : { icon }),
        };
  return {
    ...rest,
    ...(file.about === undefined ? {} : { about: file.about }),
    ...(file.color === undefined ? {} : { color: file.color }),
    ...mark,
    ...(file.legacyId === undefined ? {} : { legacyId: file.legacyId }),
    ...(file.retired ? { retired: true } : {}),
  };
}
