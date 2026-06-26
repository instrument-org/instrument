import { z } from "zod";

import { absolutePathJoin } from "../../lib/absolute-path-join";
import {
  listInvalidTaskFolders,
  trashInvalidTaskFolder,
} from "../../lib/invalid-task-folders";
import {
  listInvalidProjectFolders,
  trashInvalidProjectFolder,
} from "../../lib/project";
import { base, toORPCError } from "../base";

const InvalidFolderSchema = z.object({
  kind: z.enum(["project", "task"]),
  name: z.string(),
  path: z.string(),
  reason: z.string(),
});

const location = base
  .output(
    z.object({
      projectsDir: z.string(),
      rootDir: z.string(),
      tasksDir: z.string(),
    }),
  )
  .handler(({ context }) => ({
    projectsDir: context.workspaceConfig.projectsDir,
    rootDir: context.workspaceConfig.rootDir,
    tasksDir: context.workspaceConfig.tasksDir,
  }));

// Folders on disk that the app can't open as a task or project (bad name, or
// missing/corrupt settings). Surfaced so the user can discover and trash them,
// rather than reported as a telemetry exception on every scan.
const listInvalidFolders = base
  .output(InvalidFolderSchema.array())
  .handler(async ({ context }) => {
    const { projectsDir, tasksDir } = context.workspaceConfig;
    const [projects, tasks] = await Promise.all([
      listInvalidProjectFolders(),
      listInvalidTaskFolders(context.workspaceConfig),
    ]);
    return [
      ...projects.map((folder) => ({
        kind: "project" as const,
        ...folder,
        path: absolutePathJoin(projectsDir, folder.name),
      })),
      ...tasks.map((folder) => ({
        kind: "task" as const,
        ...folder,
        path: absolutePathJoin(tasksDir, folder.name),
      })),
    ];
  });

const trashInvalidFolder = base
  .input(z.object({ kind: z.enum(["project", "task"]), name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input: { kind, name } }) => {
    const result =
      kind === "project"
        ? await trashInvalidProjectFolder(name)
        : await trashInvalidTaskFolder(name, context.workspaceConfig);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    context.workspaceConfig.captureEvent(
      kind === "project"
        ? "project.invalid_folder_trashed"
        : "task.invalid_folder_trashed",
    );
  });

export const storage = {
  invalidFolders: {
    list: listInvalidFolders,
    trash: trashInvalidFolder,
  },
  location,
};
