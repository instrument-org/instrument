import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { APP_FOLDER_NAMES } from "../constants";
import { type ProjectManifestUpdate } from "../schemas/project-manifest";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { type AppConfigProject } from "./app-config/types";
import { taskDir, templateExists } from "./app-dir-utils";
import { copyProject } from "./copy-project";
import { TypedError } from "./errors";
import { updateProjectManifest } from "./project-manifest";

export async function initializeProject(
  {
    initialManifest,
    projectConfig,
    templateName,
    workspaceConfig,
  }: {
    initialManifest: Omit<ProjectManifestUpdate, "createdWithAppVersion">;
    projectConfig: AppConfigProject;
    templateName: string;
    workspaceConfig: WorkspaceConfig;
  },
  _options: { signal?: AbortSignal },
) {
  return safeTry(async function* () {
    // Ensure no folder exists
    const exists = await fs
      .access(taskDir(projectConfig))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDir(projectConfig)}`,
        ),
      );
    }
    yield* ResultAsync.fromPromise(
      fs.mkdir(taskDir(projectConfig), { recursive: true }),
      (error) =>
        new TypedError.FileSystem(
          error instanceof Error ? error.message : "Unknown error",
          { cause: error },
        ),
    );

    const templateDir = absolutePathJoin(
      workspaceConfig.templatesDir,
      templateName,
    );

    const doesTemplateExist = await templateExists({
      folderName: templateName,
      workspaceConfig,
    });

    if (!doesTemplateExist) {
      return errAsync(
        new TypedError.NotFound(`Template does not exist: ${templateName}`),
      );
    }

    yield* copyProject({
      includePrivateFolder: false,
      isTemplate: true,
      sourceDir: templateDir,
      targetDir: taskDir(projectConfig),
    });

    yield* updateProjectManifest(projectConfig, {
      ...initialManifest,
      createdWithAppVersion: workspaceConfig.appVersion,
    });

    // Create standard directories so they appear in the file tree. Avoids agent
    // spending a tool call to create them.
    const standardDirs = [
      APP_FOLDER_NAMES.output,
      APP_FOLDER_NAMES.scripts,
      APP_FOLDER_NAMES.tmp,
    ];
    for (const dirName of standardDirs) {
      yield* ResultAsync.fromPromise(
        fs.mkdir(absolutePathJoin(taskDir(projectConfig), dirName), {
          recursive: true,
        }),
        (error) =>
          new TypedError.FileSystem(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
      );
    }

    return ok({ projectConfig });
  });
}
