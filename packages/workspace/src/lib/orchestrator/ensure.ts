import { err, ok, type Result, type ResultAsync, safeTry } from "neverthrow";

import { isChatId } from "../../schemas/chat-id";
import { SubdomainPartSchema } from "../../schemas/subdomain-part";
import { type TaskId } from "../../schemas/task-id";
import { type TypedError } from "../errors";
import { getTasks } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { newTaskId } from "../new-task-id";
import { getWorkspaceConfig } from "../workspace-config";

/** What the orchestrator window opens on. */
const ORCHESTRATOR_FOLDER_NAME = SubdomainPartSchema.parse("instrument");
export const ORCHESTRATOR_TITLE = "Instrument";

/**
 * The window's own record, created the first time. It holds what belongs to
 * the window rather than to any one chat: the folders granted before any chat
 * asked, what the user has seen in each chat, which chat an app was asked for
 * in, and the pages the window's browser has open. The chats themselves are
 * records of their own under `chats/`. One window today: the first by
 * creation wins when several exist.
 */
export function ensureOrchestrator(): ResultAsync<
  { taskId: TaskId },
  TypedError.Type
> {
  return safeTry(async function* () {
    const workspaceConfig = getWorkspaceConfig();
    const { tasks } = await getTasks(workspaceConfig, {
      direction: "asc",
      sortBy: "createdAt",
    });
    const existing = tasks.find(
      (task) => task.kind === "orchestrator" && !isChatId(task.id),
    );
    const taskId = existing
      ? existing.id
      : yield* await createOrchestratorTask();
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
  const found = ensureOrchestrator().match(
    (ids) => ids.taskId,
    (error) => {
      windowIds.delete(root);
      throw error;
    },
  );
  windowIds.set(root, found);
  return found;
}

async function createOrchestratorTask(): Promise<
  Result<TaskId, TypedError.Type>
> {
  const workspaceConfig = getWorkspaceConfig();
  const taskId = await newTaskId({
    preferredFolderName: ORCHESTRATOR_FOLDER_NAME,
    workspaceConfig,
  });
  const initialized = await initializeTask(
    {
      initialSettings: { kind: "orchestrator", name: ORCHESTRATOR_TITLE },
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
