import { err, ok, type Result, type ResultAsync, safeTry } from "neverthrow";

import { type StoreId } from "../../schemas/store-id";
import { SubdomainPartSchema } from "../../schemas/subdomain-part";
import { type TaskId } from "../../schemas/task-id";
import { type TypedError } from "../errors";
import { getTasks } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { newTaskId } from "../new-task-id";
import { getWorkspaceConfig } from "../workspace-config";
import { latestOrNewSessionId } from "./latest-session";

/** What the orchestrator window opens on. */
const ORCHESTRATOR_FOLDER_NAME = SubdomainPartSchema.parse("instrument");
const ORCHESTRATOR_TITLE = "Instrument";

/**
 * The orchestrator task and the session the window talks to, creating both the
 * first time. One orchestrator today: the first by creation wins when several
 * exist, and nothing here offers a second, though nothing assumes there is
 * only one either.
 */
export function ensureOrchestrator(): ResultAsync<
  { sessionId: StoreId.Session; taskId: TaskId },
  TypedError.Type
> {
  return safeTry(async function* () {
    const workspaceConfig = getWorkspaceConfig();
    const { tasks } = await getTasks(workspaceConfig, {
      direction: "asc",
      sortBy: "createdAt",
    });
    const existing = tasks.find((task) => task.kind === "orchestrator");

    const taskId = existing
      ? existing.id
      : yield* await createOrchestratorTask();
    const sessionId = yield* await latestOrNewSessionId(taskId);
    return ok({ sessionId, taskId });
  });
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
