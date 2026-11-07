import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import {
  everyProjectsFolderPaths,
  setProjectFolders,
} from "../permissions/project-folders";
import { validateFolderName } from "../project-folder-name";
import { rewriteFileSync } from "../rewrite-file";
import { isSystemClutter } from "../system-clutter";
import { getWorkspaceConfig } from "../workspace-config";
import {
  type ProjectFileRead,
  parseProjectFile,
  renderProjectFile,
  PROJECT_FILE_NAME,
  ProjectFileSchema,
  PROJECTS_FOLDER_NAME,
  toTheSecond,
} from "./project-file";

const ulid = monotonicFactory();

/** The shape of a 1.x project's id too, which the migration keeps as the project's. */
const PROJECT_ID_PREFIX = "prj_";

/** Crockford's base 32, which a ULID is written in. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How long a project's name may be. Short names keep the marks readable. */
export const PROJECT_NAME_MAX = 24;

export { PROJECT_FILE_NAME, PROJECTS_FOLDER_NAME } from "./project-file";

/**
 * A project: a folder in the workspace's `Projects/`, named for it, that chats
 * are filed under. The `AGENTS.md` in it holds the instructions every chat
 * filed under it is read with; a folder without one is a project with none.
 */
export const ProjectSchema = ProjectFileSchema.extend({
  name: z.string(),
  /**
   * Its id is not in its file yet: a folder the person made, or an
   * `AGENTS.md` they copied in, goes by an id drawn from the folder's name,
   * the same on every computer, until something points at it by that id and
   * it is written down (`saveProjectId`).
   */
  unsaved: z.literal(true).optional(),
});

export type Project = z.output<typeof ProjectSchema>;

/** A folder of the user's that work under a project uses, by its path on disk. */
export const ProjectFolderSchema = z.object({ path: z.string() });

export type ProjectFolder = z.output<typeof ProjectFolderSchema>;

/**
 * A project as the app lists it: its file, and the folders granted under it on
 * this computer, which are kept in its permission settings rather than in the
 * file.
 */
export const ListedProjectSchema = ProjectSchema.extend({
  folders: z.array(ProjectFolderSchema).optional(),
});

export type ListedProject = z.output<typeof ListedProjectSchema>;

/** What the user picks about a project. Anything left out is left alone. */
export interface ProjectChange {
  about?: string;
  color?: string;
  emoji?: string;
  folders?: ProjectFolder[];
  /** A Phosphor icon's name; picking one takes the emoji away, as an emoji takes the icon. */
  icon?: string;
  /** Empty takes them away. */
  instructions?: string;
  name?: string;
}

/** A name a project's folder cannot take, said to the person who typed it. */
export class ProjectNameError extends Error {}

/**
 * Makes a project and returns it, with its instructions and the folders granted
 * under it on this computer. A name already in use returns that project as it
 * is instead, since its folder is its name, and is refused with a
 * `ProjectNameError` when instructions or folders were given, which would
 * otherwise be dropped without a word; one retired under that name comes
 * back, with the instructions and folders it had unless new ones are given.
 * A grant that fails takes back the project it was for, so no project is left
 * made without the folders it was made with.
 */
export async function createProject({
  folders = [],
  ...project
}: {
  about?: string;
  color?: string;
  emoji?: string;
  folders?: ProjectFolder[];
  icon?: string;
  instructions?: string;
  name: string;
}): Promise<Project> {
  const made = await Promise.resolve().then(() => createProjectNow(project));
  if (
    made.was === "in use" &&
    (folders.length > 0 || Boolean(project.instructions?.trim()))
  ) {
    throw new ProjectNameError(
      `There is already a project called “${made.project.name}”`,
    );
  }
  if (made.was === "in use" || folders.length === 0) {
    return made.project;
  }
  try {
    await setProjectFolders(
      made.project.id,
      folders.map((folder) => folder.path),
    );
  } catch (error) {
    takeBackProject(made);
    throw error;
  }
  return made.project;
}

/**
 * Every project: the ones in use first, in the order they were made, then the
 * retired ones after, so a menu can stop at the first retired entry and a row
 * can still name a project the chat was tagged with before it was retired. Each
 * with the folders granted under it on this computer.
 */
export async function listProjects(): Promise<ListedProject[]> {
  const projects = await readProjects(getWorkspaceConfig().rootDir);
  const granted = await everyProjectsFolderPaths();
  return projects.map((project) => {
    const paths = granted.get(project.id) ?? [];
    return paths.length > 0
      ? { ...project, folders: paths.map((each) => ({ path: each })) }
      : project;
  });
}

/** A new project's id: stable across renames, which move its folder. */
function newProjectId(at?: number): string {
  return `${PROJECT_ID_PREFIX}${ulid(at)}`;
}

/**
 * The id a project whose file names none goes by: drawn from its folder's
 * name, so every computer reading the same folder agrees on it, and in a new
 * id's shape.
 */
export function folderProjectId(name: string): string {
  const digest = createHash("sha256").update(name.toLowerCase()).digest();
  let id = "";
  for (let i = 0; i < 26; i += 1) {
    id += CROCKFORD.charAt((digest[i] ?? 0) % 32);
  }
  return `${PROJECT_ID_PREFIX}${id}`;
}

/**
 * Writes a project's id into its file if it is not there yet, before anything
 * keeps that id, so the project keeps it when its folder is renamed. Answers
 * whether the workspace has a project by that id. `rootDir` is the
 * workspace's, for a caller that holds it rather than the workspace config.
 */
export function saveProjectId(
  projectId: string,
  rootDir?: string,
): Promise<boolean> {
  return Promise.resolve().then(() => {
    const root = rootDir ?? getWorkspaceConfig().rootDir;
    const project = readProjectsSync(root).find(
      (entry) => entry.id === projectId,
    );
    if (project?.unsaved) {
      rewriteProjectSync(root, project, (current) => current);
    }
    return project !== undefined;
  });
}

/**
 * Every project under a workspace root, in list order. Synchronous and
 * file-level, for the boot migrations that write projects before the workspace
 * is up, and for the writes, which read the projects they change.
 */
export function readProjectsSync(rootDir: string): Project[] {
  const dir = projectsDirOf(rootDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return inListOrder(
    projectFolderNames(entries).flatMap((name) => {
      const project = readProjectFolder(path.join(dir, name));
      return project ? [project] : [];
    }),
  );
}

/**
 * Every project under a workspace root, in list order, read off the main
 * thread and all at once. A `AGENTS.md` a cloud drive moved off this computer
 * takes most of a second to read, while the drive downloads it.
 */
async function readProjects(rootDir: string): Promise<Project[]> {
  const dir = projectsDirOf(rootDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const read = await Promise.all(
    projectFolderNames(entries).map((name) =>
      readProjectFolderAsync(path.join(dir, name)),
    ),
  );
  return inListOrder(read.flatMap((project) => (project ? [project] : [])));
}

/** Every folder in `Projects/` but what the system leaves there. */
function projectFolderNames(entries: fs.Dirent[]): string[] {
  return entries
    .filter((entry) => entry.isDirectory() && !isSystemClutter(entry.name))
    .map((entry) => entry.name);
}

/** The ones in use in the order they were made, then the retired ones. */
function inListOrder(projects: Project[]): Project[] {
  const sorted = projects.toSorted(
    (a, b) =>
      a.created.getTime() - b.created.getTime() || a.id.localeCompare(b.id),
  );
  return [
    ...sorted.filter((project) => !project.retired),
    ...sorted.filter((project) => project.retired),
  ];
}

/**
 * Takes a project out of the menus. The chats that carry it keep it, since
 * they were about that subject when they were filed and still are.
 */
export function retireProject(projectId: string): Promise<void> {
  return Promise.resolve().then(() => {
    retireProjectNow(projectId);
  });
}

/** What a name becomes: no hash, one space between words, bounded. */
export function projectName(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, PROJECT_NAME_MAX)
    .trim();
}

/**
 * Where every project's folder is: `Projects/` at the top level of the folder
 * the person picked, so they can read a project, change one, or rename one in
 * a file manager.
 *
 * Builds before this kept it in the workspace's hidden `.instrument/`;
 * `moveProjectsToFolder` brings it out once, at launch.
 */
export function projectsDir(): AbsolutePath {
  return AbsolutePathSchema.parse(projectsDirOf(getWorkspaceConfig().rootDir));
}

/**
 * The name a new project from elsewhere can take: its own, made safe for a
 * folder, or with a number after it when another project has that name.
 */
export function unusedProjectName(
  raw: string,
  taken: readonly string[],
): string {
  const base = projectFolderName(raw);
  const keys = new Set(taken.map(nameKey));
  if (!keys.has(nameKey(base))) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, PROJECT_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!keys.has(nameKey(name))) {
      return name;
    }
  }
}

/**
 * Changes what the user chose about a project. A new name moves the project's
 * folder, and one another project has, or one no folder can take, is refused
 * with a `ProjectNameError`; anything left out is left alone. Its folders are
 * granted on this computer, in its permission settings.
 */
export async function updateProject(
  projectId: string,
  change: ProjectChange,
): Promise<void> {
  const found = await Promise.resolve().then(() =>
    updateProjectNow(projectId, change),
  );
  if (found && change.folders !== undefined) {
    await setProjectFolders(
      projectId,
      change.folders.map((folder) => folder.path),
    );
  }
}

/**
 * Writes a project whole into the `AGENTS.md` in the folder named for it, making
 * the folder the first time. The name is the caller's to have made unique and
 * safe. A key this build does not know rides along on the project's `others`,
 * read off the file it came from, so a round trip through the app keeps what
 * another client wrote.
 */
export function writeProjectSync(rootDir: string, project: Project): Project {
  return rewriteProjectSync(rootDir, project, () => project);
}

/**
 * Applies `change` to the project as its `AGENTS.md` holds it at the moment of
 * writing, so a change to its front matter keeps instructions the person
 * edited since the project was read, and answers with what was written. `project`
 * stands in where the file is gone or names another project. A file that
 * names no id yet is this project's, and is written with the id it went by.
 */
function rewriteProjectSync(
  rootDir: string,
  project: Project,
  change: (onDisk: Project) => Project,
): Project {
  let written = project;
  rewriteFileSync(
    path.join(projectsDirOf(rootDir), project.name, PROJECT_FILE_NAME),
    (text) => {
      const onDisk =
        text === undefined
          ? undefined
          : parseProjectFile(text, { at: project.created });
      const { unsaved: _unsaved, ...kept } = project;
      written = change(
        onDisk !== undefined && (onDisk.id ?? project.id) === project.id
          ? { ...onDisk, id: project.id, name: project.name }
          : kept,
      );
      const { name: _name, unsaved: _stillUnsaved, ...file } = written;
      return renderProjectFile(file);
    },
  );
  return written;
}

/** A name the person typed, or a `ProjectNameError` saying why a folder cannot take it. */
function checkedProjectName(raw: string): string {
  const name = projectName(raw);
  if (name.startsWith(".")) {
    throw new ProjectNameError("Project name can't start with a period");
  }
  const checked = validateFolderName(name, "Project");
  if (checked.isErr()) {
    throw new ProjectNameError(checked.error.message);
  }
  return checked.value;
}

/**
 * What `createProjectNow` did: found a project in use under the name, brought a
 * retired one back (kept as it was, to put back), or made a new one.
 */
type MadeProject =
  | { retired: Project; project: Project; was: "retired" }
  | { project: Project; was: "in use" | "new" };

function createProjectNow({
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
}): MadeProject {
  const rootDir = getWorkspaceConfig().rootDir;
  const wanted = checkedProjectName(name);
  const instructions = given?.trim();
  const existing = readProjectsSync(rootDir).find(
    (project) => nameKey(project.name) === nameKey(wanted),
  );
  if (existing) {
    if (!existing.retired) {
      return { project: existing, was: "in use" };
    }
    const project = rewriteProjectSync(rootDir, existing, (current) => {
      const {
        emoji: _emoji,
        icon: _icon,
        retired: _retired,
        ...revived
      } = current;
      return {
        ...revived,
        ...(about ? { about } : {}),
        ...(color ? { color } : {}),
        ...markAfter(current, { emoji, icon }),
        ...(instructions ? { instructions } : {}),
      };
    });
    return { retired: existing, project, was: "retired" };
  }
  const project: Project = {
    ...(about ? { about } : {}),
    ...(color ? { color } : {}),
    created: toTheSecond(new Date()),
    ...markAfter({}, { emoji, icon }),
    id: newProjectId(),
    ...(instructions ? { instructions } : {}),
    name: wanted,
  };
  return { project: writeProjectSync(rootDir, project), was: "new" };
}

/**
 * A project's mark after a change: an icon or an emoji, never both, so the
 * one just picked replaces the other. What the change leaves out stays, and
 * an empty one is none.
 */
function markAfter(
  current: { emoji?: string; icon?: string },
  change: { emoji?: string; icon?: string },
): { emoji?: string; icon?: string } {
  if (change.icon) {
    return { icon: change.icon };
  }
  if (change.emoji) {
    return { emoji: change.emoji };
  }
  const emoji = change.emoji ?? current.emoji;
  const icon = change.icon ?? current.icon;
  return { ...(emoji ? { emoji } : {}), ...(icon ? { icon } : {}) };
}

/**
 * Puts back what `createProjectNow` changed: a retired project retired again as
 * it was, or a new one's file gone, with its folder when nothing else is in
 * it, since a folder of the person's can stand where the project was made.
 */
function takeBackProject(made: MadeProject): void {
  const rootDir = getWorkspaceConfig().rootDir;
  if (made.was === "retired") {
    writeProjectSync(rootDir, made.retired);
    return;
  }
  if (made.was === "new") {
    const folder = path.join(projectsDirOf(rootDir), made.project.name);
    fs.rmSync(path.join(folder, PROJECT_FILE_NAME), { force: true });
    try {
      fs.rmdirSync(folder);
    } catch {
      // Something of the person's is in it, so the folder stays.
    }
  }
}

function nameKey(name: string): string {
  return projectName(name).toLowerCase();
}

/**
 * One project by its folder: what its `AGENTS.md` says, or a project with no
 * instructions where the folder has none. Nothing where the file is there
 * but cannot be read. The name is the folder's, so a folder renamed in a file
 * manager is a project renamed.
 */
function readProjectFolder(folderPath: string): Project | undefined {
  const file = path.join(folderPath, PROJECT_FILE_NAME);
  try {
    // When the file was last written stands in for a `created` it does not
    // hold, which is what a project the person made by hand has.
    // oxlint-disable-next-line studio/no-sync-content-read -- synchronous on purpose: each project write reads, checks the name and writes in one run, so two cannot interleave, and listProjects reads every AGENTS.md async first.
    const text = fs.readFileSync(file, "utf8");
    return projectIn(
      folderPath,
      parseProjectFile(text, { at: fs.statSync(file).mtime }),
    );
  } catch (error) {
    return isMissing(error) ? folderOnlyProject(folderPath) : undefined;
  }
}

async function readProjectFolderAsync(
  folderPath: string,
): Promise<Project | undefined> {
  const file = path.join(folderPath, PROJECT_FILE_NAME);
  try {
    const [text, stat] = await Promise.all([
      fs.promises.readFile(file, "utf8"),
      fs.promises.stat(file),
    ]);
    return projectIn(folderPath, parseProjectFile(text, { at: stat.mtime }));
  } catch (error) {
    return isMissing(error) ? folderOnlyProject(folderPath) : undefined;
  }
}

/** A project folder with no `AGENTS.md` in it, made when the folder was. */
function folderOnlyProject(folderPath: string): Project | undefined {
  try {
    const stat = fs.statSync(folderPath);
    return projectIn(folderPath, {
      created: toTheSecond(stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime),
    });
  } catch {
    return undefined;
  }
}

/** The project a folder's file makes it, by the folder's name when the file names no id. */
function projectIn(folderPath: string, file: ProjectFileRead): Project {
  const name = path.basename(folderPath);
  return file.id === undefined
    ? { ...file, id: folderProjectId(name), name, unsaved: true }
    : { ...file, id: file.id, name };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** Where every project's folder is, under a workspace root. */
function projectsDirOf(rootDir: string): string {
  return path.join(rootDir, PROJECTS_FOLDER_NAME);
}

function retireProjectNow(projectId: string): void {
  const rootDir = getWorkspaceConfig().rootDir;
  const project = readProjectsSync(rootDir).find(
    (entry) => entry.id === projectId,
  );
  if (project) {
    rewriteProjectSync(rootDir, project, (current) => ({
      ...current,
      retired: true,
    }));
  }
}

/**
 * A name as a folder can hold it, for names that come from somewhere other
 * than the person typing one (an older project, a 1.x project): the characters
 * a folder name cannot have become a dash, and a name left with nothing
 * becomes "Project".
 */
function projectFolderName(raw: string): string {
  const name = projectName(
    raw
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, ""),
  ).replace(/[. ]+$/, "");
  return validateFolderName(name, "Project").isOk() ? name : "Project";
}

/** Writes the change to the project's file; false for a project not there. */
function updateProjectNow(projectId: string, change: ProjectChange): boolean {
  const rootDir = getWorkspaceConfig().rootDir;
  const projects = readProjectsSync(rootDir);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    return false;
  }
  let name = project.name;
  if (change.name !== undefined) {
    name = checkedProjectName(change.name);
    const clash = projects.find(
      (entry) =>
        entry.id !== projectId && nameKey(entry.name) === nameKey(name),
    );
    if (clash) {
      throw new ProjectNameError(
        `There is already a project called “${clash.name}”`,
      );
    }
    if (name !== project.name) {
      const dir = projectsDirOf(rootDir);
      fs.renameSync(path.join(dir, project.name), path.join(dir, name));
    }
  }
  rewriteProjectSync(rootDir, { ...project, name }, (current) => {
    const { emoji: _emoji, icon: _icon, instructions, ...rest } = current;
    const nextInstructions =
      change.instructions === undefined
        ? instructions
        : change.instructions.trim();
    return {
      ...rest,
      ...(change.about === undefined ? {} : { about: change.about }),
      ...(change.color === undefined ? {} : { color: change.color }),
      ...markAfter(current, change),
      ...(nextInstructions ? { instructions: nextInstructions } : {}),
    };
  });
  return true;
}
