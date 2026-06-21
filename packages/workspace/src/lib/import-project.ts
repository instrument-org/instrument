import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import { ulid } from "ulid";

import { AppDirSchema } from "../schemas/paths";
import { ProjectSubdomainSchema } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { extractProjectZip } from "./extract-project-zip";
import { pathExists } from "./path-exists";

interface ImportProjectOptions {
  workspaceConfig: WorkspaceConfig;
  zipFileData: string;
}

export async function importProject(
  { workspaceConfig, zipFileData }: ImportProjectOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const subdomain = ProjectSubdomainSchema.parse(
      `import-${ulid().toLowerCase()}`,
    );

    // For tasks the folder name is identical to the subdomain.
    const projectDir = AppDirSchema.parse(
      absolutePathJoin(workspaceConfig.projectsDir, subdomain),
    );

    const projectExists = await pathExists(projectDir);
    if (projectExists) {
      return errAsync(
        new TypedError.Conflict(`Task directory already exists: ${projectDir}`),
      );
    }

    yield* ResultAsync.fromPromise(
      extractProjectZip({
        outputDir: projectDir,
        zipBlob: new Blob([Buffer.from(zipFileData, "base64")]),
      }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to extract zip file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return ok({ projectConfig: subdomain });
  });
}
