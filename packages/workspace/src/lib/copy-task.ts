import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import { ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath } from "../schemas/paths";
import { TypedError } from "./errors";
import { getIgnore } from "./get-ignore";
import { normalizePath } from "./normalize-path";

export function copyTask({
  includePrivateFolder,
  isTemplate,
  sourceDir,
  targetDir,
}: {
  includePrivateFolder: boolean;
  isTemplate: boolean;
  sourceDir: AbsolutePath;
  targetDir: AbsolutePath;
}) {
  return ResultAsync.fromPromise(
    getIgnore(sourceDir),
    (error) =>
      new TypedError.FileSystem(
        `Failed to get ignore patterns for task copy: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ),
  )
    .andThen((ignore) => {
      if (isTemplate) {
        // New tasks will generate their own title and icon
        ignore.add(TASK_SETTINGS_FILE_NAME);
        // Screenshots can confuse the agent
        ignore.add("screenshot.*");
      }
      return ok(ignore);
    })
    .andThen((ignore) =>
      ResultAsync.fromPromise(
        fs.cp(sourceDir, targetDir, {
          filter: (src) => {
            const relativePath = path.relative(sourceDir, src);
            if (relativePath === "") {
              return true;
            }
            if (
              includePrivateFolder &&
              relativePath.startsWith(TASK_FOLDER_NAMES.private)
            ) {
              return true;
            }
            return !ignore.ignores(normalizePath(relativePath));
          },
          recursive: true,
        }),
        (error) =>
          new TypedError.FileSystem(
            `Failed to copy task files: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
      ).map(() => true),
    );
}
