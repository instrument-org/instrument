import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { type DeviceId } from "../../schemas/device-id";
import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import {
  everyProjectsFolderPaths,
  setProjectFolders,
} from "../permissions/project-folders";
import { validateFolderName } from "../project-folder-name";
import { writingChatRecords } from "../records/installed-records";
import { rewriteFileSync } from "../rewrite-file";
import { applySyncedOps } from "../synced-store/synced-files";
import { isSystemClutter } from "../system-clutter";
import { utcStamp } from "../utc-stamp";
import { getWorkspaceConfig, hasWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import {
  type ProjectFileRead,
  parseProjectFile,
  PROJECT_FILE_NAME,
  ProjectFileSchema,
  PROJECTS_FOLDER_NAME,
  renderInstructionsFile,
  toTheSecond,
} from "./project-file";
import {
  matchProjectFolders,
  PROJECTS_DOMAIN,
  type ProjectRecord,
  readProjectRecords,
  writeProjectRecords,
} from "./project-records";

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
 * What else the app knows about it is its record in the projects store
 * (`project-records.ts`).
 */
export const ProjectSchema = ProjectFileSchema.extend({
  name: z.string(),
  /**
   * It has no record yet: a folder the person made goes by an id drawn from
   * its name, the same on every computer, until a read that knows its device
   * writes the record down (`saveProjectId`, or any read in a running
   * workspace).
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
  /** Empty takes it away. */
  about?: string;
  /** Empty takes it away, leaving the color its name gives it. */
  color?: string;
  emoji?: string;
  folders?: ProjectFolder[];
  /** A Phosphor icon's name; picking one takes the emoji away, as an emoji takes the icon. */
  icon?: string;
  /** Empty takes them away. */
  instructions?: string;
  name?: string;
  /** Out of the menus, or back in them. */
  retired?: boolean;
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
 * The id a project with no record goes by: drawn from its folder's name, so
 * every computer reading the same folder agrees on it, and in a new id's
 * shape. Builds before this one gave a folder whose file named no id the
 * same one.
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
 * The device this process writes as, where the workspace is running: the one
 * its chat records are written as. Nothing before the workspace is set up,
 * when a read writes nothing down.
 */
function runningDevice(): DeviceId | undefined {
  return (
    writingChatRecords()?.device ??
    (hasWorkspaceConfig() ? getWorkspaceConfig().deviceId : undefined)
  );
}

function deviceFor(device: DeviceId | undefined): DeviceId {
  const found = device ?? runningDevice();
  if (found === undefined) {
    throw new Error("A project is written as a device, and none is set up");
  }
  return found;
}

/**
 * Writes a project's record down if it has none yet, before anything keeps
 * its id, so the project keeps it when its folder is renamed. Answers whether
 * the workspace has a project by that id. `rootDir` is the workspace's, for a
 * caller that holds it rather than the workspace config.
 */
export function saveProjectId(
  projectId: string,
  rootDir?: string,
): Promise<boolean> {
  return Promise.resolve().then(() => {
    const root = rootDir ?? getWorkspaceConfig().rootDir;
    return readProjectsSync(root, { device: deviceFor(undefined) }).some(
      (entry) => entry.id === projectId,
    );
  });
}

/** What a read of one project folder found. */
type FolderRead =
  | { file: ProjectFileRead; name: string }
  | { file?: undefined; made: Date; name: string }
  | undefined;

/**
 * Every project under a workspace root, in list order. Synchronous and
 * file-level, for the boot migrations that write projects before the workspace
 * is up, and for the writes, which read the projects they change.
 *
 * A read that knows its device (given, or the running workspace's) writes
 * down what it settles: a record for a folder that has none, and a folder a
 * record has moved to (`matchProjectFolders`). One that does not, or is
 * given `null`, leaves them as they read, marking the projects with no
 * record `unsaved`.
 */
export function readProjectsSync(
  rootDir: string,
  { device = runningDevice() }: { device?: DeviceId | null } = {},
): Project[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDirOf(rootDir), { withFileTypes: true });
  } catch {
    return [];
  }
  const dir = projectsDirOf(rootDir);
  return settled(
    rootDir,
    projectFolderNames(entries).map((name) =>
      readProjectFolder(path.join(dir, name)),
    ),
    device ?? undefined,
  );
}

/**
 * Every project under a workspace root, in list order, its files read off the
 * main thread and all at once. A `AGENTS.md` a cloud drive moved off this
 * computer takes most of a second to read, while the drive downloads it.
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
  return settled(rootDir, read, runningDevice());
}

/**
 * The projects the folders make, each with its record, writing down what a
 * read settles where it knows its device.
 */
function settled(
  rootDir: string,
  folders: readonly FolderRead[],
  device: DeviceId | undefined,
): Project[] {
  const read = folders.flatMap((folder) => (folder ? [folder] : []));
  const records = readProjectRecords(rootDir);
  const fileIds = new Map(
    read.flatMap((folder) =>
      folder.file?.id === undefined ? [] : [[folder.name, folder.file.id]],
    ),
  );
  const match = matchProjectFolders({
    fileIds,
    folders: read.map((folder) => folder.name),
    records,
  });
  const taken = new Set([...records.keys(), ...match.byFolder.values()]);
  const toWrite: { id: string; record: ProjectRecord }[] =
    match.renamed.flatMap(({ folder, id }) => {
      const record = records.get(id);
      return record ? [{ id, record: { ...record, folder } }] : [];
    });
  const projects = read.map((folder): Project => {
    let id = match.byFolder.get(folder.name);
    const record = id === undefined ? undefined : records.get(id);
    const fromFile = {
      ...(folder.file?.instructions
        ? { instructions: folder.file.instructions }
        : {}),
      ...(folder.file?.others ? { others: folder.file.others } : {}),
    };
    if (id !== undefined && record) {
      return { ...projectOfRecord(id, record), ...fromFile, name: folder.name };
    }
    if (id === undefined) {
      id = unusedFolderId(folder.name, taken);
      taken.add(id);
    }
    // No record yet: what an earlier build's front matter said, or the
    // folder alone.
    const { id: _fileId, ...file } = folder.file ?? {
      created: toTheSecond(folder.made),
    };
    const project: Project = { ...file, id, name: folder.name };
    toWrite.push({ id, record: recordOf(project) });
    return device === undefined ? { ...project, unsaved: true } : project;
  });
  if (device !== undefined) {
    writeProjectRecords(rootDir, device, toWrite);
  }
  return inListOrder(projects);
}

/** The id drawn from a folder's name, or the next one past an id in use. */
function unusedFolderId(name: string, taken: ReadonlySet<string>): string {
  let id = folderProjectId(name);
  for (let n = 2; taken.has(id); n += 1) {
    id = folderProjectId(`${name}\n${n}`);
  }
  return id;
}

/** A project as its record has it, before its instructions are read. */
function projectOfRecord(id: string, record: ProjectRecord): Project {
  return {
    ...(record.about ? { about: record.about } : {}),
    ...(record.color ? { color: record.color } : {}),
    created: toTheSecond(new Date(record.created)),
    ...(record.emoji ? { emoji: record.emoji } : {}),
    ...(record.icon ? { icon: record.icon } : {}),
    id,
    ...(record.legacyId ? { legacyId: record.legacyId } : {}),
    name: record.folder,
    ...(record.retired ? { retired: true } : {}),
  };
}

/** The record a project is written down as: everything but its words. */
export function recordOf(project: Project): ProjectRecord {
  return {
    ...(project.about ? { about: project.about } : {}),
    ...(project.color ? { color: project.color } : {}),
    created: utcStamp(project.created),
    ...(project.emoji ? { emoji: project.emoji } : {}),
    folder: project.name,
    ...(project.icon ? { icon: project.icon } : {}),
    ...(project.legacyId ? { legacyId: project.legacyId } : {}),
    ...(project.retired ? { retired: true } : {}),
  };
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
 * Writes a project: its record, as `device` (the running workspace's when
 * none is given), and its folder, made the first time. Its `AGENTS.md` is
 * left as it is with `keepWords`, so a change to anything else never touches
 * the file or an edit to it made since it was read; otherwise it is written
 * only where the instructions differ from what it says, and instructions left
 * empty take the file away, with nothing of anyone else's in it. The name is
 * the caller's to have made unique and safe.
 */
export function writeProjectSync(
  rootDir: string,
  project: Project,
  {
    device,
    keepWords = false,
  }: { device?: DeviceId; keepWords?: boolean } = {},
): Project {
  const { unsaved: _unsaved, ...written } = project;
  const folder = path.join(projectsDirOf(rootDir), written.name);
  fs.mkdirSync(folder, { recursive: true });
  writeProjectRecords(rootDir, deviceFor(device), [
    { id: written.id, record: recordOf(written) },
  ]);
  if (!keepWords) {
    writeInstructionsSync(folder, written.instructions);
  }
  return written;
}

/**
 * Puts the instructions in a project folder's `AGENTS.md`, keeping front
 * matter of anyone else's as it is on disk at the moment of writing. Leaves
 * the file alone where it already says them.
 */
function writeInstructionsSync(
  folder: string,
  instructions: string | undefined,
): void {
  const file = path.join(folder, PROJECT_FILE_NAME);
  const wanted = instructions?.trim() ?? "";
  const held = readTextIfThere(file);
  const onDisk =
    held === undefined ? undefined : parseProjectFile(held, { at: new Date() });
  if ((onDisk?.instructions ?? "") === wanted) {
    return;
  }
  const next = renderInstructionsFile({
    instructions: wanted,
    others: onDisk?.others,
  });
  if (next === "") {
    fs.rmSync(file, { force: true });
    return;
  }
  rewriteFileSync(file, (current) =>
    renderInstructionsFile({
      instructions: wanted,
      others:
        current === undefined
          ? undefined
          : parseProjectFile(current, { at: new Date() }).others,
    }),
  );
}

function readTextIfThere(file: string): string | undefined {
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- synchronous on purpose: each project write reads, checks and writes in one run, so two cannot interleave.
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
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
    const {
      emoji: _emoji,
      icon: _icon,
      retired: _retired,
      ...revived
    } = existing;
    const project = writeProjectSync(
      rootDir,
      {
        ...revived,
        ...(about ? { about } : {}),
        ...(color ? { color } : {}),
        ...markAfter(existing, { emoji, icon }),
        ...(instructions ? { instructions } : {}),
      },
      { keepWords: !instructions },
    );
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
 * it was, or a new one's record and file gone, with its folder when nothing
 * else is in it, since a folder of the person's can stand where the project
 * was made.
 */
function takeBackProject(made: MadeProject): void {
  const rootDir = getWorkspaceConfig().rootDir;
  if (made.was === "retired") {
    writeProjectSync(rootDir, made.retired);
    return;
  }
  if (made.was === "new") {
    applySyncedOps({
      device: deviceFor(undefined),
      devicesDir: workspaceLayout(rootDir).devicesDir,
      domain: PROJECTS_DOMAIN,
      ops: [{ key: made.project.id, t: "del" }],
    });
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
 * One project folder: what its `AGENTS.md` says, front matter an earlier
 * build wrote included, or only when the folder was made where it has no
 * file. Nothing where the file is there but cannot be read.
 */
function readProjectFolder(folderPath: string): FolderRead {
  const file = path.join(folderPath, PROJECT_FILE_NAME);
  const name = path.basename(folderPath);
  try {
    // When the file was last written stands in for a `created` it does not
    // hold, which is what a project the person made by hand has.
    // oxlint-disable-next-line studio/no-sync-content-read -- synchronous on purpose: each project write reads, checks the name and writes in one run, so two cannot interleave, and listProjects reads every AGENTS.md async first.
    const text = fs.readFileSync(file, "utf8");
    return {
      file: parseProjectFile(text, { at: fs.statSync(file).mtime }),
      name,
    };
  } catch (error) {
    return isMissing(error) ? folderOnly(folderPath) : undefined;
  }
}

async function readProjectFolderAsync(folderPath: string): Promise<FolderRead> {
  const file = path.join(folderPath, PROJECT_FILE_NAME);
  try {
    const [text, stat] = await Promise.all([
      fs.promises.readFile(file, "utf8"),
      fs.promises.stat(file),
    ]);
    return {
      file: parseProjectFile(text, { at: stat.mtime }),
      name: path.basename(folderPath),
    };
  } catch (error) {
    return isMissing(error) ? folderOnly(folderPath) : undefined;
  }
}

/** A project folder with no `AGENTS.md` in it, made when the folder was. */
function folderOnly(folderPath: string): FolderRead {
  try {
    const stat = fs.statSync(folderPath);
    return {
      made: stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime,
      name: path.basename(folderPath),
    };
  } catch {
    return undefined;
  }
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
    writeProjectSync(
      rootDir,
      { ...project, retired: true },
      { keepWords: true },
    );
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

/** Writes the change to the project; false for a project not there. */
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
  const {
    about,
    color,
    emoji: _emoji,
    icon: _icon,
    instructions,
    retired,
    ...rest
  } = project;
  // Empty takes the line away, as it does for instructions.
  const nextAbout = change.about ?? about;
  const nextColor = change.color ?? color;
  const nextRetired = change.retired ?? retired;
  const nextInstructions =
    change.instructions === undefined
      ? instructions
      : change.instructions.trim();
  writeProjectSync(
    rootDir,
    {
      ...rest,
      ...(nextAbout ? { about: nextAbout } : {}),
      ...(nextColor ? { color: nextColor } : {}),
      ...markAfter(project, change),
      ...(nextInstructions ? { instructions: nextInstructions } : {}),
      name,
      ...(nextRetired ? { retired: true } : {}),
    },
    { keepWords: change.instructions === undefined },
  );
  return true;
}
