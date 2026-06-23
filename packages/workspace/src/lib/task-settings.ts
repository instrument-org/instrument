import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import { err, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { publisher } from "../rpc/publisher";
import { type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import {
  type TaskSettings,
  TaskSettingsSchema,
  type TaskSettingsUpdate,
  TaskSettingsUpdateSchema,
} from "../schemas/task-settings";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";

export async function getTaskSettings(
  dir: TaskDir,
): Promise<TaskSettings | undefined> {
  const settingsPath = getTaskSettingsPath(dir);

  try {
    const content = await fs.readFile(settingsPath, "utf8");
    const parsed = TaskSettingsSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function updateTaskSettings(
  taskId: TaskId,
  updates: TaskSettingsUpdate,
) {
  return safeTry(async function* () {
    const parseResult = TaskSettingsUpdateSchema.safeParse(updates);
    if (!parseResult.success) {
      return err(
        new TypedError.Parse(
          `Invalid task settings updates: ${parseResult.error.message}`,
          { cause: parseResult.error },
        ),
      );
    }

    const validatedUpdates = parseResult.data;

    const dir = taskDir(taskId);
    const settingsPath = getTaskSettingsPath(dir);

    let existing: TaskSettings = { name: "" };

    try {
      existing = (await getTaskSettings(dir)) ?? { name: "" };
    } catch {
      // File doesn't exist or is invalid, use defaults
    }

    yield* ResultAsync.fromPromise(
      fs
        .mkdir(getTaskPrivateDir(dir), { recursive: true })
        .then(() =>
          fs.writeFile(
            settingsPath,
            JSON.stringify({ ...existing, ...validatedUpdates }, null, 2),
          ),
        ),
      (error) =>
        new TypedError.FileSystem(
          `Failed to write task settings: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    publisher.publish("task.updated", {
      id: taskId,
    });

    return ok(undefined);
  });
}

function getTaskSettingsPath(dir: TaskDir) {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_SETTINGS_FILE_NAME);
}
