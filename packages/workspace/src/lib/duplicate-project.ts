import {
  errAsync,
  ok,
  safeTry,
} from "neverthrow";
import fs from "node:fs/promises";

import {
  type TaskId,
} from "../schemas/task-id";
import {
  type WorkspaceConfig,
} from "../types";
import {
  createAppConfig,
} from "./app-config/create";
import {
  newProjectConfig,
} from "./app-config/new";
import {
  getAppPrivateDir,
  sessionStorePath,
  taskDir,
} from "./app-dir-utils";
import {
  copyProject,
} from "./copy-project";
import {
  TypedError,
} from "./errors";
import {
  pathExists,
} from "./path-exists";
import {
  getProjectManifest,
  updateProjectManifest,
} from "./project-manifest";
import {
  getProjectState,
  setProjectState,
} from "./project-state-store";

interface DuplicateProjectOptions {
  keepHistory: boolean;
  sourceSubdomain: TaskId;
  workspaceConfig: WorkspaceConfig;
}

export async function duplicateProject(
  { keepHistory, sourceSubdomain, workspaceConfig }: DuplicateProjectOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const sourceConfig = createAppConfig({ subdomain: sourceSubdomain });

    const projectConfig = await newProjectConfig({
      workspaceConfig,
    });

    const projectExists = await pathExists(taskDir(projectConfig));
    if (projectExists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDir(projectConfig)}`,
        ),
      );
    }

    const sourceExists = await pathExists(taskDir(sourceConfig));
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${taskDir(sourceConfig)}`,
        ),
      );
    }

    yield* copyProject({
      includePrivateFolder: false,
      isTemplate: false,
      sourceDir: taskDir(sourceConfig),
      targetDir: taskDir(projectConfig),
    });

    const sourceManifest = await getProjectManifest(taskDir(sourceConfig));
    const sourceName = sourceManifest?.name || sourceConfig;
    const duplicateName = `Copy of ${sourceName}`;

    const sourceProjectState = await getProjectState(taskDir(sourceConfig));

    if (keepHistory) {
      const sourceSessionDbPath = sessionStorePath(taskDir(sourceConfig));
      const targetSessionDbPath = sessionStorePath(taskDir(projectConfig));

      if (await pathExists(sourceSessionDbPath)) {
        const targetPrivateDir = getAppPrivateDir(taskDir(projectConfig));
        await fs.mkdir(targetPrivateDir, { recursive: true });
        await fs.copyFile(sourceSessionDbPath, targetSessionDbPath);
      }

      await setProjectState(taskDir(projectConfig), sourceProjectState);
    } else {
      // Preserve only the selected model from the source project
      if (sourceProjectState.selectedModelURI) {
        await setProjectState(taskDir(projectConfig), {
          selectedModelURI: sourceProjectState.selectedModelURI,
        });
      }
    }

    const existingManifest = await getProjectManifest(taskDir(projectConfig));

    yield* updateProjectManifest(projectConfig, {
      ...(existingManifest && { iconName: existingManifest.iconName }),
      name: duplicateName,
    });

    return ok({ projectConfig });
  });
}
