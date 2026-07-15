import { existsSync } from "node:fs";
import path from "node:path";

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
  if (hasUsableVenv(taskId)) {
    return undefined;
  }

  const existing = inFlightVenvCreation.get(taskId);
  if (existing) {
    return awaitVenvCreation({ creation: existing, signal });
  }

  const creation = runUvCommand({
    args: ["venv", "--python", MANAGED_PYTHON_VERSION, taskVenvDir(taskId)],
    cwd: getTaskWorkDir(taskDir(taskId)),
    taskId,
  })
    .then((result) =>
      result.exitCode === 0
        ? undefined
        : { exitCode: result.exitCode, output: result.combined },
    )
    .catch((error: unknown) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => inFlightVenvCreation.delete(taskId));

  inFlightVenvCreation.set(taskId, creation);
  return awaitVenvCreation({ creation, signal });
}

function awaitVenvCreation({
  creation,
  signal,
}: {
  creation: Promise<TaskVenvError | undefined>;
  signal?: AbortSignal;
}) {
  if (signal === undefined) {
    return creation;
  }

  if (signal.aborted) {
    return Promise.resolve(cancelledVenvCreation());
  }

  const abortSignal = signal;
  return new Promise<TaskVenvError | undefined>((resolve) => {
    function onAbort() {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(cancelledVenvCreation());
    }

    const finish = (result: TaskVenvError | undefined) => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    void creation.then(finish);
  });
}

function cancelledVenvCreation(): TaskVenvError {
  return {
    exitCode: 1,
    output: "Python environment setup was cancelled.",
  };
}

function hasUsableVenv(taskId: TaskId) {
  return (
    existsSync(taskVenvPython(taskId)) &&
    existsSync(path.join(taskVenvDir(taskId), "pyvenv.cfg"))
  );
}
