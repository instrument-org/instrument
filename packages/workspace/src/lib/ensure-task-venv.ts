import { existsSync } from "node:fs";
import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { runUvCommand } from "./run-uv";
import { MANAGED_PYTHON_VERSION, taskVenvDir, taskVenvPython } from "./uv";
import { workDir } from "./work-dir";

export interface TaskVenvError {
  exitCode: number;
  output: string;
}

// Tool calls can come from concurrent sessions for the same task. Reuse the
// in-flight creation so two `uv venv` processes cannot race on the venv.
const inFlightVenvCreation = new Map<
  ChatId,
  Promise<TaskVenvError | undefined>
>();

/**
 * Makes the task's venv. The bash worker replaces it with a request to the main
 * thread, so creation has one owner and the dedupe above covers the skill
 * installs that run there too.
 */
let createTaskVenv = runUvVenv;

export async function ensureTaskVenvForTask({
  signal,
  chatId,
}: {
  signal?: AbortSignal;
  chatId: ChatId;
}): Promise<TaskVenvError | undefined> {
  if (hasUsableVenv(chatId)) {
    return undefined;
  }

  const existing = inFlightVenvCreation.get(chatId);
  if (existing) {
    return awaitVenvCreation({ creation: existing, signal });
  }

  const creation = createTaskVenv(chatId).finally(() =>
    inFlightVenvCreation.delete(chatId),
  );

  inFlightVenvCreation.set(chatId, creation);
  return awaitVenvCreation({ creation, signal });
}

export function setTaskVenvCreator(
  next: (chatId: ChatId) => Promise<TaskVenvError | undefined>,
): void {
  createTaskVenv = next;
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

function hasUsableVenv(chatId: ChatId) {
  return (
    existsSync(taskVenvPython(chatId)) &&
    existsSync(path.join(taskVenvDir(chatId), "pyvenv.cfg"))
  );
}

function runUvVenv(chatId: ChatId): Promise<TaskVenvError | undefined> {
  // `--clear` because we only get here when the venv is missing or unusable,
  // so replacing whatever is there is the intent. Without it uv refuses to
  // touch an existing venv, which would strand a task whose interpreter went
  // missing: the venv never becomes usable, so every python/pip call fails and
  // nothing in the app can recover it. uv still declines to clear a directory
  // that is not a virtual environment, so this cannot delete a task's own files.
  return runUvCommand({
    args: [
      "venv",
      "--clear",
      "--python",
      MANAGED_PYTHON_VERSION,
      taskVenvDir(chatId),
    ],
    cwd: workDir(chatId),
    chatId,
  })
    .then((result) =>
      result.exitCode === 0
        ? undefined
        : { exitCode: result.exitCode, output: result.combined },
    )
    .catch((error: unknown) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }));
}
