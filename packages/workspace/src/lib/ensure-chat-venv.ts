import { existsSync } from "node:fs";
import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { linkPythonBase, refreshPythonBaseIfDue } from "./python-base";
import { ensureManagedPython, runUvCommand } from "./run-uv";
import { MANAGED_PYTHON_VERSION, chatVenvDir, chatVenvPython } from "./uv";
import { workDir } from "./work-dir";

export interface ChatVenvError {
  exitCode: number;
  output: string;
}

// Tool calls can come from concurrent sessions for the same task. Reuse the
// in-flight creation so two `uv venv` processes cannot race on the venv.
const inFlightVenvCreation = new Map<
  ChatId,
  Promise<ChatVenvError | undefined>
>();

/**
 * Makes the task's venv. The bash worker replaces it with a request to the main
 * thread, so creation has one owner and the dedupe above covers the skill
 * installs that run there too.
 */
let createChatVenv = runUvVenv;

/**
 * Asks for a check of the base packages when one is due. The bash worker
 * replaces it with a request to the main thread, so one thread owns the
 * refresh and the processes it starts.
 */
let requestPythonBaseRefresh = refreshPythonBaseIfDue;

export function setPythonBaseRefresher(next: () => void): void {
  requestPythonBaseRefresh = next;
}

/**
 * The chat's venv, made first when it has no usable one, with the base
 * packages behind it once they are installed. Every `python`, `pip` and
 * `uv` command comes through here, so it is also where a due check of the
 * base packages starts, in the background.
 */
export async function ensureChatVenv({
  signal,
  chatId,
}: {
  signal?: AbortSignal;
  chatId: ChatId;
}): Promise<ChatVenvError | undefined> {
  const error = await ensureVenvExists({ signal, chatId });
  if (error === undefined) {
    await linkPythonBase(chatId);
  }
  requestPythonBaseRefresh();
  return error;
}

function ensureVenvExists({
  signal,
  chatId,
}: {
  signal?: AbortSignal;
  chatId: ChatId;
}): Promise<ChatVenvError | undefined> {
  if (hasUsableVenv(chatId)) {
    return Promise.resolve(undefined);
  }

  const existing = inFlightVenvCreation.get(chatId);
  if (existing) {
    return awaitVenvCreation({ creation: existing, signal });
  }

  const creation = createChatVenv(chatId).finally(() =>
    inFlightVenvCreation.delete(chatId),
  );

  inFlightVenvCreation.set(chatId, creation);
  return awaitVenvCreation({ creation, signal });
}

export function setChatVenvCreator(
  next: (chatId: ChatId) => Promise<ChatVenvError | undefined>,
): void {
  createChatVenv = next;
}

function awaitVenvCreation({
  creation,
  signal,
}: {
  creation: Promise<ChatVenvError | undefined>;
  signal?: AbortSignal;
}) {
  if (signal === undefined) {
    return creation;
  }

  if (signal.aborted) {
    return Promise.resolve(cancelledVenvCreation());
  }

  const abortSignal = signal;
  return new Promise<ChatVenvError | undefined>((resolve) => {
    function onAbort() {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(cancelledVenvCreation());
    }

    const finish = (result: ChatVenvError | undefined) => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    void creation.then(finish);
  });
}

function cancelledVenvCreation(): ChatVenvError {
  return {
    exitCode: 1,
    output: "Python environment setup was cancelled.",
  };
}

function hasUsableVenv(chatId: ChatId) {
  return (
    existsSync(chatVenvPython(chatId)) &&
    existsSync(path.join(chatVenvDir(chatId), "pyvenv.cfg"))
  );
}

async function runUvVenv(chatId: ChatId): Promise<ChatVenvError | undefined> {
  const python = await ensureManagedPython();
  if (python) {
    return python;
  }
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
      chatVenvDir(chatId),
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
