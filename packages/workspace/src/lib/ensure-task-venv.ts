import { existsSync } from "node:fs";

import { type TaskId } from "../schemas/task-id";
import { runUvCommand } from "./run-uv";
import { getTaskWorkDir, taskDir } from "./task-dir-utils";
import { MANAGED_PYTHON_VERSION, taskVenvDir, taskVenvPython } from "./uv";

export interface TaskVenvError {
  exitCode: number;
  output: string;
}

// Tool calls can come from concurrent sessions for the same task. Reuse the
// in-flight creation so two `uv venv` processes cannot race on work/.venv.
const inFlightVenvCreation = new Map<
  TaskId,
  Promise<TaskVenvError | undefined>
>();

export async function ensureTaskVenvForTask({
  signal,
  taskId,
}: {
  signal?: AbortSignal;
  taskId: TaskId;
}): Promise<TaskVenvError | undefined> {
  if (existsSync(taskVenvPython(taskId))) {
    return undefined;
  }

  const existing = inFlightVenvCreation.get(taskId);
  if (existing) {
    return existing;
  }

  const creation = runUvCommand({
    args: ["venv", "--python", MANAGED_PYTHON_VERSION, taskVenvDir(taskId)],
    cwd: getTaskWorkDir(taskDir(taskId)),
    signal,
    taskId,
  })
    .then((result) =>
      result.exitCode === 0
        ? undefined
        : { exitCode: result.exitCode, output: result.combined },
    )
    .finally(() => inFlightVenvCreation.delete(taskId));

  inFlightVenvCreation.set(taskId, creation);
  return creation;
}
