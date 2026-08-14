import { err, ok, ResultAsync, safeTry } from "neverthrow";

import { publisher } from "../rpc/publisher";
import { type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import {
  type TaskSettings,
  type TaskSettingsUpdate,
  TaskSettingsUpdateSchema,
} from "../schemas/task-settings";
import { TypedError } from "./errors";
import { getCurrentDate } from "./get-current-date";
import { taskDir } from "./task-dir-utils";
import { readTaskRecord, updateTaskRecord } from "./task-record";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What the app knows about a task: its title, whether it is pinned or unread,
 * which project it belongs to, and when it was made and last worked in.
 *
 * One of the two views over the task record; the state beside it is the other.
 * See task-record.ts for what separates them.
 */
export async function getTaskSettings(
  dir: TaskDir,
): Promise<TaskSettings | undefined> {
  const record = await readTaskRecord(dir);
  return record.settings;
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

    yield* ResultAsync.fromPromise(
      writeMergedSettings(taskId, parseResult.data),
      (error) =>
        new TypedError.FileSystem(
          `Failed to write task settings: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    // Only the settings view publishes this. A draft or a tab is a change to
    // the same file and no business of the task list, so its writers publish
    // `task.stateUpdated` instead and the list is not woken by them.
    publisher.publish("task.updated", {
      id: taskId,
    });

    return ok(undefined);
  });
}

async function writeMergedSettings(
  taskId: TaskId,
  updates: TaskSettingsUpdate,
): Promise<void> {
  await updateTaskRecord(taskDir(taskId), (record) => {
    // Raw first so `state` and anything this build cannot read survive the
    // write, then the parsed settings so their defaults apply, then the change.
    const merged: Record<string, unknown> = {
      ...record.raw,
      ...(record.settings ?? { name: "" }),
      ...updates,
    };

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

    return merged;
  });
}
