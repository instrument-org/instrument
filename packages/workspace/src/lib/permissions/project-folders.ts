import { AbsolutePathSchema } from "../../schemas/paths";
import { getCurrentDate } from "../get-current-date";
import { updateJsonRecordSync } from "../json-record-file";
import {
  type PermissionSettings,
  permissionSettingsOf,
  permissionsFileIn,
  readPermissionSettings,
  updatePermissionSettings,
} from "./rules";

/**
 * Every project's granted folders on this computer, by project id, each in the
 * order it was added. Kept in this computer's permission settings rather
 * than in the project's `AGENTS.md`; see `projects` there.
 */
export async function everyProjectsFolderPaths(): Promise<
  Map<string, string[]>
> {
  const settings = await readPermissionSettings();
  return new Map(
    Object.keys(settings.projects).map((projectId) => [
      projectId,
      pathsIn(settings.projects, projectId),
    ]),
  );
}

/**
 * Sets the folders granted under a project to `paths`, in that order. A folder
 * already granted keeps when it was added, and a project left with none is
 * taken out of the file.
 */
export async function setProjectFolders(
  projectId: string,
  paths: readonly string[],
): Promise<void> {
  await updatePermissionSettings((settings) => ({
    ...settings,
    projects: projectsWithFolders(
      settings.projects,
      projectId,
      paths,
      getCurrentDate(),
    ),
  }));
}

/**
 * Adds folders to the ones granted under a project, for a launch step that
 * runs before the workspace is up and names this computer's machine folder
 * outright. A folder already granted is left as it is, so a second run adds
 * nothing.
 */
export function addProjectFoldersSync({
  machineDir,
  paths,
  projectId,
}: {
  machineDir: string;
  paths: readonly string[];
  projectId: string;
}): void {
  updateJsonRecordSync(permissionsFileIn(machineDir), (record) => {
    const { projects } = permissionSettingsOf(record);
    const next = addedProjectFolders(projects, projectId, paths, new Date());
    return pathsIn(next, projectId).length ===
      pathsIn(projects, projectId).length
      ? undefined
      : { projects: next };
  });
}

/** Every project's folders with `paths` added after the ones `projectId` has. */
export function addedProjectFolders(
  projects: Projects,
  projectId: string,
  paths: readonly string[],
  at: Date,
): Projects {
  return projectsWithFolders(
    projects,
    projectId,
    [...pathsIn(projects, projectId), ...paths],
    at,
  );
}

type Projects = PermissionSettings["projects"];

/**
 * Every project's folders with the ones under `projectId` set to `paths`, a path
 * that is not absolute left out, since it names no folder on this computer.
 */
function projectsWithFolders(
  projects: Projects,
  projectId: string,
  paths: readonly string[],
  at: Date,
): Projects {
  const held = projects[projectId]?.folders ?? [];
  const folders = [...new Set(paths)].flatMap((each) => {
    const known = held.find((folder) => folder.path === each);
    if (known) {
      return [known];
    }
    const parsed = AbsolutePathSchema.safeParse(each);
    return parsed.success ? [{ addedAt: at, path: parsed.data }] : [];
  });
  const { [projectId]: _taken, ...rest } = projects;
  return folders.length === 0 ? rest : { ...rest, [projectId]: { folders } };
}

function pathsIn(projects: Projects, projectId: string): string[] {
  return (projects[projectId]?.folders ?? []).map((folder) => folder.path);
}
