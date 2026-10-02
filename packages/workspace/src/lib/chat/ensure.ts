import { err, ok, type Result, ResultAsync, safeTry } from "neverthrow";

import { SubdomainPartSchema } from "../../schemas/subdomain-part";
import { type TaskId } from "../../schemas/task-id";
import { type TypedError } from "../errors";
import { getTasks } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { newTaskId } from "../new-task-id";
import { isChatId } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig } from "../workspace-config";

/** What the app window opens on. */
const WINDOW_FOLDER_NAME = SubdomainPartSchema.parse("instrument");
export const INSTRUMENT_TITLE = "Instrument";

/** A find-or-create still running, by the workspace it was asked in. */
const pending = new Map<
  string,
  Promise<Result<{ taskId: TaskId }, TypedError.Type>>
>();

/**
 * The window's own record, created the first time. It holds what belongs to
 * the window rather than to any one chat: the folders granted before any chat
 * asked, what the user has seen in each chat, which chat an app was asked for
 * in, and the pages the window's browser has open. The chats themselves are
 * records of their own under `chats/`. One window today: the first by
 * creation wins when several exist.
 *
 * Callers asking while one is already finding or creating it share that one,
 * since the window's first load asks from several routes at once and two
 * creates would both claim the same folder name.
 */
export function ensureWindowRecord(): ResultAsync<
  { taskId: TaskId },
  TypedError.Type
> {
  const root = getWorkspaceConfig().rootDir;
  const running = pending.get(root);
  if (running) {
    return new ResultAsync(running);
  }
  const started = Promise.resolve(findOrCreateWindowRecord()).finally(() => {
    pending.delete(root);
  });
  pending.set(root, started);
  return new ResultAsync(started);
}

function findOrCreateWindowRecord(): ResultAsync<
  { taskId: TaskId },
  TypedError.Type
> {
  return safeTry(async function* () {
    const workspaceConfig = getWorkspaceConfig();
    const { tasks } = await getTasks(workspaceConfig, {
      direction: "asc",
      sortBy: "createdAt",
    });
    // A chat's record that landed under `tasks/` (an imported chat, say) is
    // a chat still, not the window, though it is not in `chats/`.
    let existing: TaskId | undefined;
    for (const task of tasks) {
      if (task.kind !== "chat" || isChatId(task.id)) {
        continue;
      }
      const settings = await getTaskSettings(taskDir(task.id));
      if (settings?.chatSessionId === undefined) {
        existing = task.id;
        break;
      }
    }
    const taskId = existing ?? (yield* await createWindowRecord());
    return ok({ taskId });
  });
}

/** The window's record id for the workspace it was asked in, found once. */
const windowIds = new Map<string, Promise<TaskId>>();

export function windowTaskId(): Promise<TaskId> {
  const root = getWorkspaceConfig().rootDir;
  const known = windowIds.get(root);
  if (known) {
    return known;
  }
  const found = ensureWindowRecord().match(
    (ids) => ids.taskId,
    (error) => {
      windowIds.delete(root);
      throw error;
    },
  );
  windowIds.set(root, found);
  return found;
}

async function createWindowRecord(): Promise<Result<TaskId, TypedError.Type>> {
  const workspaceConfig = getWorkspaceConfig();
  const taskId = await newTaskId({
    preferredFolderName: WINDOW_FOLDER_NAME,
    workspaceConfig,
  });
  const initialized = await initializeTask(
    {
      initialSettings: { kind: "chat", name: INSTRUMENT_TITLE },
      taskId,
      workspaceConfig,
    },
    {},
  );
  if (initialized.isErr()) {
    return err(initialized.error);
  }
  return ok(taskId);
}
