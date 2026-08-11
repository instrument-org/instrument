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
import { createWriteQueue } from "./create-write-queue";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import { getWorkspaceConfig } from "./workspace-config";

const enqueue = createWriteQueue();

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

/**
 * Mark that something happened in this task, which is what orders the list.
 *
 * Best-effort: a task whose activity stamp fails to write sorts by the old
 * filesystem fallback, which is worse but not wrong, and losing the turn over
 * it would be.
 */
export async function recordTaskActivity(taskId: TaskId): Promise<void> {
  const result = await updateTaskSettings(taskId, {
    lastActivityAt: getCurrentDate(),
  });
  if (result.isErr()) {
    getWorkspaceConfig().captureException(result.error);
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

    // Read, merge and write as one step. The writers do overlap -- a generated
    // title lands while a sent message records activity, an agent marks a task
    // unread while the user marks it read -- and without this each would merge
    // onto the settings the other had not written yet, so the later write would
    // drop the earlier field with no error anywhere.
    yield* ResultAsync.fromPromise(
      enqueue(taskId, () => writeMergedSettings(taskId, parseResult.data)),
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

async function writeMergedSettings(
  taskId: TaskId,
  updates: TaskSettingsUpdate,
) {
  const dir = taskDir(taskId);

  let existing: TaskSettings = { name: "" };

  try {
    existing = (await getTaskSettings(dir)) ?? { name: "" };
  } catch {
    // File doesn't exist or is invalid, use defaults
  }

  const merged = { ...existing, ...updates };
  // A `null` projectId is the clear sentinel: drop the key entirely rather
  // than persisting `null`.
  if (updates.projectId === null) {
    delete merged.projectId;
  }
  // Same for pinnedAt: `null` unpins by removing the key.
  if (updates.pinnedAt === null) {
    delete merged.pinnedAt;
  }
  // Same for unreadIndicator: `null` marks read by removing the key.
  if (updates.unreadIndicator === null) {
    delete merged.unreadIndicator;
  }

  await fs.mkdir(getTaskPrivateDir(dir), { recursive: true });
  await fs.writeFile(getTaskSettingsPath(dir), JSON.stringify(merged, null, 2));
}
