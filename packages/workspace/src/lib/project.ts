import {
  TASK_PRIVATE_FOLDER_NAME,
  TASK_SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";

import { PROJECT_INSTRUCTIONS_FILE_NAME } from "../constants";
import {
  type Project,
  type ProjectSettings,
  ProjectSettingsSchema,
} from "../schemas/project";
import { newProjectId, type ProjectId } from "../schemas/project-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getTasks } from "./get-tasks";
import { validateProjectName } from "./project-folder-name";
import { updateTaskSettings } from "./task-settings";
import { getWorkspaceConfig } from "./workspace-config";
import {
  getProjectIndex,
  type ProjectIndex,
  removeProjectFolder,
  setProjectFolder,
} from "./workspace-store";

export async function createProject({
  description,
  instructions,
  name,
}: {
  description?: string;
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

  const existing = await listProjectFolders();
  if (existing.some((f) => f.toLowerCase() === folderName.toLowerCase())) {
    return err(
      new TypedError.Conflict(`A project named "${folderName}" already exists`),
    );
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
        { createdAt, description: description ?? "", id },
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

  await setProjectFolder(id, folderName);

  return ok({
    createdAt,
    description: description ?? "",
    id,
    instructions: instructions ?? "",
    name: folderName,
  });
}

export async function deleteProject(
  id: ProjectId,
): Promise<Result<undefined, TypedError.FileSystem>> {
  const folder = await resolveProjectFolder(id);
  if (!folder) {
    await removeProjectFolder(id);
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

  await removeProjectFolder(id);

  // Unfile any tasks that pointed at this project.
  const { tasks } = await getTasks(config);
  for (const task of tasks) {
    if (task.projectId === id) {
      await updateTaskSettings(task.id, { projectId: null });
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

// Convenience for the agent run: the instructions to inject, or undefined when
// the task has no (resolvable) project.
export async function getProjectInstructions(
  id: ProjectId,
): Promise<string | undefined> {
  const project = await getProject(id);
  if (project.isErr()) {
    return undefined;
  }
  const instructions = project.value.instructions.trim();
  return instructions.length > 0 ? instructions : undefined;
}

export async function listProjects(): Promise<Project[]> {
  const folders = await listProjectFolders();
  const projects: Project[] = [];
  for (const folder of folders) {
    const result = await readProject(folder);
    if (result.isOk()) {
      projects.push(result.value);
    }
  }
  return projects.toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export async function updateProject(
  id: ProjectId,
  {
    description,
    instructions,
    name,
  }: { description?: string; instructions?: string; name?: string },
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
      const existing = await listProjectFolders();
      if (existing.some((f) => f.toLowerCase() === nextName.toLowerCase())) {
        return err(
          new TypedError.Conflict(
            `A project named "${nextName}" already exists`,
          ),
        );
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
      await setProjectFolder(id, nextName);
    }
  }

  if (description !== undefined) {
    const settings = await readProjectSettings(folderName);
    if (settings.isErr()) {
      return err(settings.error);
    }
    try {
      await fs.writeFile(
        projectSettingsPath(folderName),
        JSON.stringify({ ...settings.value, description }, null, 2),
      );
    } catch (error) {
      return err(
        new TypedError.FileSystem(`Failed to write project description`, {
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

// Resolves a ProjectId to its current folder name, trusting the workspace-store
// index first and self-healing from a disk scan when it is stale (e.g. the
// folder was renamed outside the app).
async function resolveProjectFolder(
  id: ProjectId,
): Promise<string | undefined> {
  const index: ProjectIndex = await getProjectIndex().unwrapOr({});
  const fromIndex = index[id];
  if (fromIndex) {
    const result = await readProject(fromIndex);
    if (result.isOk() && result.value.id === id) {
      return fromIndex;
    }
  }

  const projects = await listProjects();
  const match = projects.find((project) => project.id === id);
  if (match) {
    await setProjectFolder(id, match.name);
    return match.name;
  }

  return undefined;
}
