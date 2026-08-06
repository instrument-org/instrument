import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { parallel } from "radashi";

import { PROJECT_INSTRUCTIONS_FILE_NAME } from "../constants";
import { type FolderAttachment } from "../schemas/folder-attachment";
import {
  type Project,
  type ProjectFolder,
  type ProjectSettings,
  ProjectSettingsSchema,
} from "../schemas/project";
import { newProjectId, type ProjectId } from "../schemas/project-id";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getTasks } from "./get-tasks";
import { validateProjectName } from "./project-folder-name";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";
import { getWorkspaceConfig } from "./workspace-config";

interface InvalidProjectFolder {
  name: string;
  reason: string;
}

export async function addFolderToProject(
  id: ProjectId,
  path: string,
  access: FolderAttachment.Access,
): Promise<
  Result<
    Project,
    | TypedError.Conflict
    | TypedError.FileSystem
    | TypedError.NotFound
    | TypedError.Parse
  >
> {
  const project = await getProject(id);
  if (project.isErr()) {
    return err(project.error);
  }
  const folders = project.value.folders.some((folder) => folder.path === path)
    ? project.value.folders
    : [...project.value.folders, { access, path }];
  return updateProject(id, { folders });
}

// Clears task references to projects whose folder no longer exists. In-app
// deletes already sweep referencing tasks (see deleteProject); this covers a
// project deleted from disk while the app was closed, which would otherwise
// leave a dangling projectId. Best-effort: a single failed clear is captured
// and the sweep continues. Each cleared task publishes `task.updated`.
export async function clearOrphanedProjectRefs(): Promise<TaskId[]> {
  const config = getWorkspaceConfig();
  const projects = await listProjects();
  const existingIds = new Set(projects.map((p) => p.id));
  const { tasks } = await getTasks(config);

  const clearedTaskIds: TaskId[] = [];
  for (const task of tasks) {
    if (!task.projectId || existingIds.has(task.projectId)) {
      continue;
    }
    const cleared = await updateTaskSettings(task.id, { projectId: null });
    if (cleared.isErr()) {
      config.captureException(cleared.error, { scopes: ["workspace"] });
      continue;
    }
    clearedTaskIds.push(task.id);
  }

  return clearedTaskIds;
}

export async function createProject({
  description,
  folders,
  instructions,
  name,
}: {
  description?: string;
  folders?: ProjectFolder[];
  instructions?: string;
  name: string;
}): Promise<
  Result<
    Project,
    TypedError.Conflict | TypedError.FileSystem | TypedError.Parse
  >
> {
  const validated = validateProjectName(name);
  if (validated.isErr()) {
    return err(validated.error);
  }
  const folderName = validated.value;

  const conflict = await findNameConflict(folderName);
  if (conflict.isErr()) {
    return err(conflict.error);
  }

  const id = newProjectId();
  const createdAt = new Date();

  try {
    await fs.mkdir(
      absolutePathJoin(projectDir(folderName), TASK_PRIVATE_FOLDER_NAME),
      { recursive: true },
    );
    await fs.writeFile(
      projectSettingsPath(folderName),
      JSON.stringify(
        {
          createdAt,
          description: description ?? "",
          folders: folders ?? [],
          id,
        },
        null,
        2,
      ),
    );
    await fs.writeFile(projectInstructionsPath(folderName), instructions ?? "");
  } catch (error) {
    return err(
      new TypedError.FileSystem(`Failed to create project "${folderName}"`, {
        cause: error,
      }),
    );
  }

  return ok({
    createdAt,
    description: description ?? "",
    folders: folders ?? [],
    id,
    instructions: instructions ?? "",
    name: folderName,
  });
}

export async function deleteProject(
  id: ProjectId,
): Promise<Result<undefined, TypedError.FileSystem | TypedError.Parse>> {
  const folder = await resolveProjectFolder(id);
  if (!folder) {
    return ok(undefined);
  }

  const config = getWorkspaceConfig();

  try {
    await config.trashItem(projectDir(folder));
  } catch (error) {
    return err(
      new TypedError.FileSystem(`Failed to delete project "${folder}"`, {
        cause: error,
      }),
    );
  }

  const { tasks } = await getTasks(config);
  for (const task of tasks) {
    if (task.projectId === id) {
      const cleared = await updateTaskSettings(task.id, { projectId: null });
      if (cleared.isErr()) {
        return err(cleared.error);
      }
    }
  }

  return ok(undefined);
}

export async function getProject(
  id: ProjectId,
): Promise<Result<Project, TypedError.NotFound | TypedError.Parse>> {
  const folder = await resolveProjectFolder(id);
  if (!folder) {
    return err(new TypedError.NotFound(`Project ${id} not found`));
  }
  return readProject(folder);
}

/**
 * The name of the project a task belongs to, if it belongs to one.
 *
 * Reads the live project rather than the snapshot frozen onto the task's first
 * message, because that snapshot belongs to the session it was written in and
 * this answers for whichever session is asking.
 */
export async function getTaskProjectName(
  taskId: TaskId,
): Promise<string | undefined> {
  const settings = await getTaskSettings(taskDir(taskId));
  if (!settings?.projectId) {
    return undefined;
  }
  const project = await getProject(settings.projectId);
  return project.isOk() ? project.value.name : undefined;
}

// Folders under projects/ that can't be loaded as a project because their
// .instrument/settings.json is missing or unreadable. listProjects skips these
// silently; we surface them here so the user can discover and clean them up
// (e.g. after deleting a project's settings on disk).
export async function listInvalidProjectFolders(): Promise<
  InvalidProjectFolder[]
> {
  const folders = await listProjectFolders();
  const invalid: InvalidProjectFolder[] = [];
  for (const folder of folders) {
    const settings = await readProjectSettings(folder);
    if (settings.isErr()) {
      invalid.push({
        name: folder,
        reason:
          settings.error instanceof TypedError.NotFound
            ? "Missing project settings (.instrument/settings.json)"
            : "Unreadable project settings",
      });
    }
  }
  return invalid;
}

export async function listProjects(): Promise<Project[]> {
  const folders = await listProjectFolders();
  const results = await parallel({ limit: 12 }, folders, (folder) =>
    readProject(folder),
  );
  const projects = results
    .filter((result) => result.isOk())
    .map((result) => result.value);
  return projects.toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

// Trims project instructions and treats whitespace-only as absent. Exposed so
// callers holding a loaded Project can normalize without a second disk scan.
export function normalizeProjectInstructions(
  instructions: string,
): string | undefined {
  const trimmed = instructions.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function removeFolderFromProject(
  id: ProjectId,
  path: string,
): Promise<
  Result<
    Project,
    | TypedError.Conflict
    | TypedError.FileSystem
    | TypedError.NotFound
    | TypedError.Parse
  >
> {
  const project = await getProject(id);
  if (project.isErr()) {
    return err(project.error);
  }
  return updateProject(id, {
    folders: project.value.folders.filter((folder) => folder.path !== path),
  });
}

export async function resolveProjectDir(
  id: ProjectId,
): Promise<string | undefined> {
  const folder = await resolveProjectFolder(id);
  return folder ? projectDir(folder) : undefined;
}

export async function setProjectFolderAccess(
  id: ProjectId,
  path: string,
  access: FolderAttachment.Access,
): Promise<
  Result<
    Project,
    | TypedError.Conflict
    | TypedError.FileSystem
    | TypedError.NotFound
    | TypedError.Parse
  >
> {
  const project = await getProject(id);
  if (project.isErr()) {
    return err(project.error);
  }
  return updateProject(id, {
    folders: project.value.folders.map((folder) =>
      folder.path === path ? { ...folder, access } : folder,
    ),
  });
}

// Sends an unloadable project folder to the OS trash. Refuses any folder that
// still reads as a healthy project, and any name that isn't a direct child of
// projects/, so it can't trash a real project or traverse out of the workspace.
export async function trashInvalidProjectFolder(
  name: string,
): Promise<Result<undefined, TypedError.FileSystem | TypedError.Parse>> {
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name !== nodePath.basename(name)
  ) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  const settings = await readProjectSettings(name);
  if (settings.isOk()) {
    return err(
      new TypedError.Parse("Refusing to trash a valid project this way"),
    );
  }

  try {
    await getWorkspaceConfig().trashItem(projectDir(name));
  } catch (error) {
    return err(
      new TypedError.FileSystem(`Failed to trash project folder "${name}"`, {
        cause: error,
      }),
    );
  }
  return ok(undefined);
}

export async function updateProject(
  id: ProjectId,
  {
    description,
    folders,
    instructions,
    name,
  }: {
    description?: string;
    folders?: ProjectFolder[];
    instructions?: string;
    name?: string;
  },
): Promise<
  Result<
    Project,
    | TypedError.Conflict
    | TypedError.FileSystem
    | TypedError.NotFound
    | TypedError.Parse
  >
> {
  const currentFolder = await resolveProjectFolder(id);
  if (!currentFolder) {
    return err(new TypedError.NotFound(`Project ${id} not found`));
  }

  let folderName = currentFolder;

  if (name !== undefined) {
    const validated = validateProjectName(name);
    if (validated.isErr()) {
      return err(validated.error);
    }
    const nextName = validated.value;

    if (nextName.toLowerCase() !== currentFolder.toLowerCase()) {
      const conflict = await findNameConflict(nextName);
      if (conflict.isErr()) {
        return err(conflict.error);
      }
    }

    if (nextName !== currentFolder) {
      try {
        await fs.rename(projectDir(currentFolder), projectDir(nextName));
      } catch (error) {
        return err(
          new TypedError.FileSystem(
            `Failed to rename project to "${nextName}"`,
            {
              cause: error,
            },
          ),
        );
      }
      folderName = nextName;
    }
  }

  if (description !== undefined || folders !== undefined) {
    const settings = await readProjectSettings(folderName);
    if (settings.isErr()) {
      return err(settings.error);
    }
    const nextSettings = { ...settings.value };
    if (description !== undefined) {
      nextSettings.description = description;
    }
    if (folders !== undefined) {
      nextSettings.folders = folders;
    }
    try {
      await fs.writeFile(
        projectSettingsPath(folderName),
        JSON.stringify(nextSettings, null, 2),
      );
    } catch (error) {
      return err(
        new TypedError.FileSystem(`Failed to write project settings`, {
          cause: error,
        }),
      );
    }
  }

  if (instructions !== undefined) {
    try {
      await fs.writeFile(projectInstructionsPath(folderName), instructions);
    } catch (error) {
      return err(
        new TypedError.FileSystem(`Failed to write project instructions`, {
          cause: error,
        }),
      );
    }
  }

  return readProject(folderName);
}

async function findNameConflict(
  folderName: string,
): Promise<Result<undefined, TypedError.Conflict>> {
  const existing = await listProjectFolders();
  if (existing.some((f) => f.toLowerCase() === folderName.toLowerCase())) {
    return err(
      new TypedError.Conflict(`A project named "${folderName}" already exists`),
    );
  }
  return ok(undefined);
}

async function listProjectFolders(): Promise<string[]> {
  try {
    const entries = await fs.readdir(getWorkspaceConfig().projectsDir, {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function projectDir(folderName: string) {
  return absolutePathJoin(getWorkspaceConfig().projectsDir, folderName);
}

function projectInstructionsPath(folderName: string) {
  return absolutePathJoin(
    projectDir(folderName),
    PROJECT_INSTRUCTIONS_FILE_NAME,
  );
}

function projectSettingsPath(folderName: string) {
  return absolutePathJoin(
    projectDir(folderName),
    TASK_PRIVATE_FOLDER_NAME,
    TASK_SETTINGS_FILE_NAME,
  );
}

async function readProject(
  folderName: string,
): Promise<Result<Project, TypedError.NotFound | TypedError.Parse>> {
  const settings = await readProjectSettings(folderName);
  if (settings.isErr()) {
    return err(settings.error);
  }

  let instructions = "";
  try {
    instructions = await fs.readFile(
      projectInstructionsPath(folderName),
      "utf8",
    );
  } catch {
    // No AGENTS.md yet; instructions are empty.
  }

  return ok({
    createdAt: settings.value.createdAt,
    description: settings.value.description ?? "",
    folders: settings.value.folders ?? [],
    id: settings.value.id,
    instructions,
    name: folderName,
  });
}

async function readProjectSettings(
  folderName: string,
): Promise<Result<ProjectSettings, TypedError.NotFound | TypedError.Parse>> {
  let settingsRaw: string;
  try {
    settingsRaw = await fs.readFile(projectSettingsPath(folderName), "utf8");
  } catch (error) {
    return err(
      new TypedError.NotFound(`Project "${folderName}" not found`, {
        cause: error,
      }),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsRaw);
  } catch (error) {
    return err(
      new TypedError.Parse(`Invalid project settings for "${folderName}"`, {
        cause: error,
      }),
    );
  }

  const settings = ProjectSettingsSchema.safeParse(parsed);
  if (!settings.success) {
    return err(
      new TypedError.Parse(`Invalid project settings for "${folderName}"`, {
        cause: settings.error,
      }),
    );
  }

  return ok(settings.data);
}

// Resolves a ProjectId to its current folder name by scanning `projects/`.
// The folder + settings.json is the source of truth, so the id stays stable
// even when the folder is renamed (inside or outside the app).
async function resolveProjectFolder(
  id: ProjectId,
): Promise<string | undefined> {
  const folders = await listProjectFolders();
  for (const folder of folders) {
    const settings = await readProjectSettings(folder);
    if (settings.isOk() && settings.value.id === id) {
      return folder;
    }
  }
  return undefined;
}
