import { existsSync, mkdirSync } from "node:fs";
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

  // The work dir may not exist yet (nothing else creates it when python is
  // the task's first command); a missing cwd fails execa before uv even runs.
  const workDir = getTaskWorkDir(taskDir(taskId));
  mkdirSync(workDir, { recursive: true });

  // `--clear` because we only get here when the venv is missing or unusable,
  // so replacing whatever is there is the intent. Without it uv refuses to
  // touch an existing venv, which would strand a task whose interpreter went
  // missing: the venv never becomes usable, so every python/pip call fails and
  // nothing in the app can recover it. uv still declines to clear a directory
  // that is not a virtual environment, so this cannot delete a task's own files.
  const creation = runUvCommand({
    args: [
      "venv",
      "--clear",
      "--python",
      MANAGED_PYTHON_VERSION,
      taskVenvDir(taskId),
    ],
    cwd: workDir,
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
