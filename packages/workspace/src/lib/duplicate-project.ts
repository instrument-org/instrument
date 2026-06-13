import { errAsync, ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { newProjectConfig } from "./app-config/new";
import { getAppPrivateDir, sessionStorePath } from "./app-dir-utils";
import { copyProject } from "./copy-project";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import { getProjectManifest, updateProjectManifest } from "./project-manifest";
import { getProjectState, setProjectState } from "./project-state-store";

interface DuplicateProjectOptions {
  keepHistory: boolean;
  sourceSubdomain: ProjectSubdomain;
  workspaceConfig: WorkspaceConfig;
}

export async function duplicateProject(
  { keepHistory, sourceSubdomain, workspaceConfig }: DuplicateProjectOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const sourceConfig = createAppConfig({
      subdomain: sourceSubdomain,
      workspaceConfig,
    });

    const projectConfig = await newProjectConfig({
      workspaceConfig,
    });

    const projectExists = await pathExists(projectConfig.appDir);
    if (projectExists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${projectConfig.appDir}`,
        ),
      );
    }

    const sourceExists = await pathExists(sourceConfig.appDir);
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${sourceConfig.appDir}`,
        ),
      );
    }

    yield* copyProject({
      includePrivateFolder: false,
      isTemplate: false,
      sourceDir: sourceConfig.appDir,
      targetDir: projectConfig.appDir,
    });

    const sourceManifest = await getProjectManifest(sourceConfig.appDir);
    const sourceName = sourceManifest?.name || sourceConfig.subdomain;
    const duplicateName = `Copy of ${sourceName}`;

    const sourceProjectState = await getProjectState(sourceConfig.appDir);

    if (keepHistory) {
      const sourceSessionDbPath = sessionStorePath(sourceConfig.appDir);
      const targetSessionDbPath = sessionStorePath(projectConfig.appDir);

      if (await pathExists(sourceSessionDbPath)) {
        const targetPrivateDir = getAppPrivateDir(projectConfig.appDir);
        await fs.mkdir(targetPrivateDir, { recursive: true });
        await fs.copyFile(sourceSessionDbPath, targetSessionDbPath);
      }

      await setProjectState(projectConfig.appDir, sourceProjectState);
    } else {
      // Preserve only the selected model from the source project
      if (sourceProjectState.selectedModelURI) {
        await setProjectState(projectConfig.appDir, {
          selectedModelURI: sourceProjectState.selectedModelURI,
        });
      }
    }

    const existingManifest = await getProjectManifest(projectConfig.appDir);

    yield* updateProjectManifest(projectConfig, {
      ...(existingManifest && { iconName: existingManifest.iconName }),
      name: duplicateName,
    });

    return ok({ projectConfig });
  });
}
