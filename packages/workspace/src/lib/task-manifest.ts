import { PROJECT_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { publisher } from "../rpc/publisher";
import { type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import {
  type TaskManifest,
  TaskManifestSchema,
  type TaskManifestUpdate,
  TaskManifestUpdateSchema,
} from "../schemas/task-manifest";
import { absolutePathJoin } from "./absolute-path-join";
import { taskDir } from "./app-dir-utils";
import { TypedError } from "./errors";

export async function getTaskManifest(
  dir: TaskDir,
): Promise<TaskManifest | undefined> {
  const projectManifestPath = absolutePathJoin(dir, PROJECT_MANIFEST_FILE_NAME);

  try {
    const manifestContent = await fs.readFile(projectManifestPath, "utf8");
    const parsed = TaskManifestSchema.safeParse(JSON.parse(manifestContent));
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function updateTaskManifest(
  taskId: TaskId,
  updates: TaskManifestUpdate,
) {
  return safeTry(async function* () {
    const parseResult = TaskManifestUpdateSchema.safeParse(updates);
    if (!parseResult.success) {
      return err(
        new TypedError.Parse(
          `Invalid task manifest updates: ${parseResult.error.message}`,
          { cause: parseResult.error },
        ),
      );
    }

    const validatedUpdates = parseResult.data;

    const projectManifestPath = absolutePathJoin(
      taskDir(taskId),
      PROJECT_MANIFEST_FILE_NAME,
    );

    let existing: TaskManifest = { name: "" };

    try {
      existing = (await getTaskManifest(taskDir(taskId))) ?? {
        name: "",
      };
    } catch {
      // File doesn't exist or is invalid, use default manifest
    }

    yield* ResultAsync.fromPromise(
      fs.writeFile(
        projectManifestPath,
        JSON.stringify(
          {
            ...existing,
            ...validatedUpdates,
          },
          null,
          2,
        ),
      ),
      (error) =>
        new TypedError.FileSystem(
          `Failed to write task manifest: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    publisher.publish("task.updated", {
      id: taskId,
    });

    return ok(undefined);
  });
}
