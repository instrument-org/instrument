import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import {
  everyProjectsFolderPaths,
  setProjectFolders,
} from "../permissions/project-folders";
import { validateFolderName } from "../project-folder-name";
import { rewriteFileSync } from "../rewrite-file";
import { runningPlace, type WorkspacePlace } from "../synced-store/held-stores";
import { type SyncedStore } from "../synced-store/synced-store";
import { isSystemClutter } from "../system-clutter";
import { utcStamp } from "../utc-stamp";
import { getWorkspaceConfig } from "../workspace-config";
import { readText } from "../workspace-files";
import {
  type ProjectFileRead,
  parseProjectFile,
  PROJECT_FILE_NAME,
  PROJECT_ID_FILE_NAME,
  ProjectFileSchema,
  PROJECTS_FOLDER_NAME,
  renderInstructionsFile,
  toTheSecond,
} from "./project-file";
import {
  type ProjectRecord,
  projectRecords,
  projectsStore,
  writeProjectRecords,
} from "./project-records";

/** How every project's id starts, a 1.x project's included, which the migration keeps. */
const PROJECT_ID_PREFIX = "prj_";

/** Crockford's base 32, which a ULID is written in. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How long a project's name may be. Short names keep the marks readable. */
export const PROJECT_NAME_MAX = 24;

export {
  PROJECT_FILE_NAME,
  PROJECT_ID_FILE_NAME,
  PROJECTS_FOLDER_NAME,
} from "./project-file";

/**
 * A project: a folder in the workspace's `Projects/`, named for it, that chats
 * are filed under. The `AGENTS.md` in it holds the instructions every chat
 * filed under it is read with; a folder without one is a project with none.
 * What else the app knows about it is its record in the projects store
 * (`project-records.ts`).
 */
export const ProjectSchema = ProjectFileSchema.extend({ name: z.string() });

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
  const made = await alone((store) => createProjectNow(store, project));
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
    await alone((store) => takeBackProject(store, made));
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
  const projects = await readProjects();
  const granted = await everyProjectsFolderPaths();
  return projects.map((project) => {
    const paths = granted.get(project.id) ?? [];
    return paths.length > 0
      ? { ...project, folders: paths.map((each) => ({ path: each })) }
      : project;
  });
}

/**
 * The id a new project takes, and a folder with no `.instrument-project`
 * yet: drawn from its folder's name, so a computer that sees the folder
 * before the file in it agrees on it. Builds before this one gave a folder
 * whose file named no id the same one.
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
 * Runs a change to the projects after every one asked for before it, so a
 * read, the checks on it and the write built on it see no other's half.
 */
async function alone<T>(
  run: (store: SyncedStore) => Promise<T>,
  place?: WorkspacePlace,
): Promise<T> {
  const store = await projectsStore(place);
  return store.exclusive(() => run(store));
}

/**
 * Writes a project's record down if it has none yet, before anything keeps
 * its id, so the project keeps it when its folder is renamed. Answers whether
 * the workspace has a project by that id. `rootDir` is the workspace's, for a
 * caller that holds it rather than the workspace config.
 */
export async function saveProjectId(
  projectId: string,
  rootDir?: string,
): Promise<boolean> {
  const projects = await readProjectsKeeping(
    rootDir === undefined
      ? runningPlace()
      : { device: getWorkspaceConfig().deviceId, rootDir },
    projectId,
  );
  return projects.some((entry) => entry.id === projectId);
}

/** What a read of one project folder found. */
interface FolderRead {
  /** What its `AGENTS.md` says; nothing where it has none. */
  file?: ProjectFileRead;
  /** The id its `.instrument-project` names, where it has one. */
  idFile?: string;
  /** When the folder was made, or failing that last changed. */
  made: Date;
  name: string;
  /** Its `AGENTS.md` or its `.instrument-project` is there but cannot be read just now. */
  unreadable?: true;
}

/**
 * Every project of a workspace, in list order: the running one's, or that of
 * `place`, for a launch step before the workspace is up. A read writes down
 * what it settles: a record for a folder that has none, and the
 * `.instrument-project` of a folder that names no id, or one an older folder
 * already has (a copy made in a file manager). A read with something to
 * write down reads again alone, since a change under way can look like that.
 */
export function readProjects(
  place: WorkspacePlace = runningPlace(),
): Promise<Project[]> {
  return readProjectsKeeping(place);
}

/**
 * {@link readProjects}, writing down the id of the project `keeping` names
 * even in a folder too new for {@link settled} to, since something here now
 * ties to it.
 */
async function readProjectsKeeping(
  place: WorkspacePlace,
  keeping?: string,
): Promise<Project[]> {
  const store = await projectsStore(place);
  const read = settled(store, await readFolders(place.rootDir), keeping);
  return read.idFiles.length === 0 && read.records.length === 0
    ? read.projects
    : store.exclusive(() => readProjectsAlone(store, place.rootDir, keeping));
}

/** `readProjects` inside a change, which is alone already. */
async function readProjectsAlone(
  store: SyncedStore,
  rootDir: string,
  keeping?: string,
): Promise<Project[]> {
  const { idFiles, projects, records } = settled(
    store,
    await readFolders(rootDir),
    keeping,
  );
  await writeProjectRecords(store, records);
  for (const { folder, id } of idFiles) {
    try {
      await writeIdFile(path.join(projectsDirOf(rootDir), folder), id);
    } catch {
      // A folder that cannot be written to just now takes its id file at a
      // later read, and the other projects list meanwhile.
    }
  }
  return projects;
}

async function readFolders(
  rootDir: string,
): Promise<(FolderRead | undefined)[]> {
  const dir = projectsDirOf(rootDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return Promise.all(
    projectFolderNames(entries).map((name) =>
      readProjectFolder(path.join(dir, name)),
    ),
  );
}

/**
 * The projects the folders make, each with its record, and what there is to
 * write down for them.
 *
 * A folder is the project its `.instrument-project` names, or, where it has
 * none yet, the one its `AGENTS.md` front matter named in an earlier build,
 * or else the one its name gives. Where two folders name one id, the older
 * folder keeps it and the other, a copy, becomes a project of its own. A
 * folder whose `AGENTS.md` cannot be read keeps its id from the others and
 * is left out of the list until it can, and one whose `.instrument-project`
 * cannot be read claims and writes nothing until it can, since the id it
 * names is the only tie to its chats. A folder that names no id and is
 * newer than {@link ID_FILE_WAIT_MS} takes the one its name gives without
 * writing it down: it may be another computer's project synced in ahead of
 * its `.instrument-project`, whose id the name does not give once renamed.
 * The project `keeping` names is written down however new its folder.
 */
function settled(
  store: SyncedStore,
  folders: readonly (FolderRead | undefined)[],
  keeping?: string,
): {
  idFiles: { folder: string; id: string }[];
  projects: Project[];
  records: { at: number; id: string; record: ProjectRecord }[];
} {
  const records = projectRecords(store);
  const claimed = new Set<string>();
  const idFiles: { folder: string; id: string }[] = [];
  const toWrite: { at: number; id: string; record: ProjectRecord }[] = [];
  const projects: Project[] = [];
  const oldestFirst = folders
    .flatMap((folder) => (folder ? [folder] : []))
    .toSorted(
      (a, b) =>
        a.made.getTime() - b.made.getTime() || a.name.localeCompare(b.name),
    );
  for (const folder of oldestFirst) {
    const named = folder.idFile ?? folder.file?.id;
    if (folder.unreadable && named === undefined) {
      continue;
    }
    const id =
      named !== undefined && !claimed.has(named)
        ? named
        : unusedFolderId(folder.name, claimed);
    claimed.add(id);
    if (folder.unreadable) {
      continue;
    }
    const mayBeSyncing =
      named === undefined &&
      id !== keeping &&
      Date.now() - folder.made.getTime() < ID_FILE_WAIT_MS;
    if (folder.idFile !== id && !mayBeSyncing) {
      idFiles.push({ folder: folder.name, id });
    }
    const record = records.get(id);
    const fromFile = {
      ...(folder.file?.instructions
        ? { instructions: folder.file.instructions }
        : {}),
      ...(folder.file?.others ? { others: folder.file.others } : {}),
    };
    if (record) {
      projects.push({
        ...projectOfRecord(id, record, folder.name),
        ...fromFile,
      });
      continue;
    }
    // No record yet: what an earlier build's front matter said, or the
    // folder alone.
    const { id: _fileId, ...file } = folder.file ?? {
      created: toTheSecond(folder.made),
    };
    const project: Project = { ...file, id, name: folder.name };
    // Stamped at the start of time, so the record the computer that made
    // the project wrote outranks this one whenever it syncs in after the
    // folder.
    toWrite.push({ at: 0, id, record: recordOf(project) });
    projects.push(project);
  }
  return { idFiles, projects: inListOrder(projects), records: toWrite };
}

/**
 * How long a project folder that names no id goes without one written: time
 * for a sync engine to bring the `.instrument-project` it was made with.
 */
const ID_FILE_WAIT_MS = 10 * 60 * 1000;

/** The id drawn from a folder's name, or the next one past an id in use. */
function unusedFolderId(name: string, taken: ReadonlySet<string>): string {
  let id = folderProjectId(name);
  for (let n = 2; taken.has(id); n += 1) {
    id = folderProjectId(`${name}\n${n}`);
  }
  return id;
}

/** A project as its record has it, before its instructions are read. */
function projectOfRecord(
  id: string,
  record: ProjectRecord,
  name: string,
): Project {
  return {
    ...(record.about ? { about: record.about } : {}),
    ...(record.color ? { color: record.color } : {}),
    created: toTheSecond(new Date(record.created)),
    ...(record.emoji ? { emoji: record.emoji } : {}),
    ...(record.icon ? { icon: record.icon } : {}),
    id,
    ...(record.legacyId ? { legacyId: record.legacyId } : {}),
    name,
    ...(record.retired ? { retired: true } : {}),
  };
}

/** The record a project is written down as: everything but its name and words. */
function recordOf(project: Project): ProjectRecord {
  return {
    ...(project.about ? { about: project.about } : {}),
    ...(project.color ? { color: project.color } : {}),
    created: utcStamp(project.created),
    ...(project.emoji ? { emoji: project.emoji } : {}),
    ...(project.icon ? { icon: project.icon } : {}),
    ...(project.legacyId ? { legacyId: project.legacyId } : {}),
    ...(project.retired ? { retired: true } : {}),
  };
}

/** Writes a project folder's `.instrument-project`, where it names another id or none. */
async function writeIdFile(folder: string, id: string): Promise<void> {
  const file = path.join(folder, PROJECT_ID_FILE_NAME);
  if ((await readTextIfThere(file))?.trim() === id) {
    return;
  }
  await fs.promises.writeFile(file, `${id}\n`);
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
      a.created.getTime() - b.created.getTime() ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
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
  return updateProject(projectId, { retired: true });
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
  const found = await alone((store) =>
    updateProjectNow(store, projectId, change),
  );
  if (found && change.folders !== undefined) {
    await setProjectFolders(
      projectId,
      change.folders.map((folder) => folder.path),
    );
  }
}

/**
 * Writes a project: its record, and its folder, made the first time. Its
 * `AGENTS.md` is left as it is with `keepWords`, so a change to anything else
 * never touches the file or an edit to it made since it was read; otherwise
 * it is written only where the instructions differ from what it says, and
 * instructions left empty take the file away, with nothing of anyone else's
 * in it. The name is the caller's to have made unique and safe, and nothing
 * else may be changing the projects, as in a launch step.
 */
export async function writeProject(
  project: Project,
  {
    keepWords = false,
    place = runningPlace(),
  }: { keepWords?: boolean; place?: WorkspacePlace } = {},
): Promise<Project> {
  const folder = path.join(projectsDirOf(place.rootDir), project.name);
  await fs.promises.mkdir(folder, { recursive: true });
  await writeIdFile(folder, project.id);
  await writeProjectRecords(await projectsStore(place), [
    { id: project.id, record: recordOf(project) },
  ]);
  if (!keepWords) {
    await writeInstructions(folder, project.instructions);
  }
  return project;
}

/**
 * Puts the instructions in a project folder's `AGENTS.md`, keeping front
 * matter of anyone else's as it is on disk at the moment of writing. Leaves
 * the file alone where it already says them.
 */
async function writeInstructions(
  folder: string,
  instructions: string | undefined,
): Promise<void> {
  const file = path.join(folder, PROJECT_FILE_NAME);
  const wanted = instructions?.trim() ?? "";
  // Read off the main thread, which downloads a file a cloud service keeps by
  // name only, so the write below does not wait on it.
  const held = await readTextIfThere(file);
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
    await fs.promises.rm(file, { force: true });
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

/** What reading a folder's `.instrument-project` found. */
type IdFileRead = { text: string } | "none" | "unreadable";

async function readIdFile(file: string): Promise<IdFileRead> {
  try {
    return { text: await readText(file) };
  } catch (error) {
    return isMissing(error) ? "none" : "unreadable";
  }
}

function readTextIfThere(file: string): Promise<string | undefined> {
  return readText(file).catch(() => undefined);
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

async function createProjectNow(
  store: SyncedStore,
  {
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
  },
): Promise<MadeProject> {
  const rootDir = getWorkspaceConfig().rootDir;
  const wanted = checkedProjectName(name);
  const instructions = given?.trim();
  const projects = await readProjectsAlone(store, rootDir);
  const existing = projects.find(
    (project) => nameKey(project.name) === nameKey(wanted),
  );
  if (existing) {
    if (!existing.retired) {
      return { project: existing, was: "in use" };
    }
    await store.caughtUp();
    const {
      emoji: _emoji,
      icon: _icon,
      retired: _retired,
      ...revived
    } = existing;
    const project = await writeProject(
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
    // An id with a record but no folder belonged to a project whose folder
    // was deleted, so a new one of the same name does not take its chats.
    id: unusedFolderId(
      wanted,
      new Set([
        ...projectRecords(store).keys(),
        ...projects.map((each) => each.id),
      ]),
    ),
    ...(instructions ? { instructions } : {}),
    name: wanted,
  };
  return { project: await writeProject(project), was: "new" };
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
async function takeBackProject(
  store: SyncedStore,
  made: MadeProject,
): Promise<void> {
  if (made.was === "retired") {
    await writeProject(made.retired);
    return;
  }
  if (made.was === "new") {
    await store.apply([{ key: made.project.id, t: "del" }]);
    const folder = path.join(projectsDir(), made.project.name);
    await fs.promises.rm(path.join(folder, PROJECT_FILE_NAME), { force: true });
    await fs.promises.rm(path.join(folder, PROJECT_ID_FILE_NAME), {
      force: true,
    });
    try {
      await fs.promises.rmdir(folder);
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
 * build wrote included, and the id its `.instrument-project` names. Nothing
 * where the folder is gone.
 */
async function readProjectFolder(
  folderPath: string,
): Promise<FolderRead | undefined> {
  const file = path.join(folderPath, PROJECT_FILE_NAME);
  const [made, idFile, read] = await Promise.all([
    fs.promises.stat(folderPath).then(folderMade, () => undefined),
    readIdFile(path.join(folderPath, PROJECT_ID_FILE_NAME)),
    // When the file was last written stands in for a `created` it does not
    // hold, which is what a project the person made by hand has.
    Promise.all([readText(file), fs.promises.stat(file)]).then(
      ([text, stat]) => ({ at: stat.mtime, text }),
      (error: unknown): "none" | "unreadable" =>
        isMissing(error) ? "none" : "unreadable",
    ),
  ]);
  return made === undefined
    ? undefined
    : folderRead({ idFile, made, name: path.basename(folderPath), read });
}

function folderRead({
  idFile,
  made,
  name,
  read,
}: {
  idFile: IdFileRead;
  made: Date;
  name: string;
  read: { at: Date; text: string } | "none" | "unreadable";
}): FolderRead {
  const id = typeof idFile === "object" ? idFile.text.trim() : undefined;
  return {
    ...(id ? { idFile: id } : {}),
    made,
    name,
    ...(read === "unreadable" || idFile === "unreadable"
      ? { unreadable: true }
      : {}),
    ...(typeof read === "object"
      ? { file: parseProjectFile(read.text, { at: read.at }) }
      : {}),
  };
}

/** When a folder was made, where the disk says, or else when it last changed. */
function folderMade(stat: fs.Stats): Date {
  return stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
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
async function updateProjectNow(
  store: SyncedStore,
  projectId: string,
  change: ProjectChange,
): Promise<boolean> {
  await store.caughtUp();
  const rootDir = getWorkspaceConfig().rootDir;
  const projects = await readProjectsAlone(store, rootDir);
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
      await fs.promises.rename(
        path.join(dir, project.name),
        path.join(dir, name),
      );
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
  await writeProject(
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
