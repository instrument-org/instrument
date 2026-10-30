import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { askForPythonBaseRefresh, linkPythonBase } from "./python-base";
import {
  ensureManagedPython,
  managedPythonInterpreter,
  runUvCommand,
} from "./run-uv";
import {
  MANAGED_PYTHON_VERSION,
  nearestVenv,
  venvPython,
  workVenvDir,
} from "./uv";

export interface VenvError {
  exitCode: number;
  output: string;
}

/**
 * The virtualenv `pip` installs into from `cwd`: the nearest one, or where
 * there is none, the one at the root of the work folder, made now. Either
 * is made again first when its base Python is gone.
 */
export async function venvToInstallInto({
  chatId,
  cwd,
  signal,
}: {
  chatId: ChatId;
  cwd: string;
  signal?: AbortSignal;
}): Promise<{ error: VenvError } | { venv: AbsolutePath }> {
  const venv = nearestVenv(chatId, cwd) ?? workVenvDir(chatId);
  const error = await ensureVenv({ chatId, signal, venv });
  return error ? { error } : { venv };
}

/**
 * The interpreter `python` runs from `cwd`: the nearest virtualenv's, made
 * again first when its base Python is gone, or where there is none, the
 * managed Python's own, with the standard library alone.
 */
export async function pythonToRun({
  chatId,
  cwd,
  signal,
}: {
  chatId: ChatId;
  cwd: string;
  signal?: AbortSignal;
}): Promise<
  { error: VenvError } | { python: string; venv: AbsolutePath | undefined }
> {
  const venv = nearestVenv(chatId, cwd);
  if (venv === undefined) {
    const managed = await managedPythonInterpreter();
    return "path" in managed
      ? { python: managed.path, venv }
      : { error: managed };
  }
  const error = await ensureVenv({ chatId, signal, venv });
  return error ? { error } : { python: venvPython(venv), venv };
}

// Tool calls can come from concurrent sessions for the same chat. Reuse the
// in-flight creation so two `uv venv` processes cannot race on one venv.
const inFlightVenvCreation = new Map<
  AbsolutePath,
  Promise<undefined | VenvError>
>();

/**
 * Makes a virtualenv. The bash worker replaces it with a request to the main
 * thread, so creation has one owner and the dedupe above covers the skill
 * installs that run there too.
 */
let createVenv = runUvVenv;

/**
 * Makes the virtualenv at `venv` when it has no usable interpreter: missing,
 * or made from a Python that is gone.
 */
export async function ensureVenv({
  chatId,
  signal,
  venv,
}: {
  chatId: ChatId;
  signal?: AbortSignal;
  venv: AbsolutePath;
}): Promise<undefined | VenvError> {
  // Every `python`, `pip` and `uv` command comes through here, so this is
  // where a due check of the base packages starts, in the background. The
  // command never waits on it.
  askForPythonBaseRefresh();
  if (hasUsableVenv(venv)) {
    await linkPythonBase(venv);
    return undefined;
  }

  const existing = inFlightVenvCreation.get(venv);
  if (existing) {
    return awaitVenvCreation({ creation: existing, signal });
  }

  const creation = createVenv(venv, chatId).finally(() =>
    inFlightVenvCreation.delete(venv),
  );

  inFlightVenvCreation.set(venv, creation);
  const failure = await awaitVenvCreation({ creation, signal });
  if (failure === undefined) {
    // Behind the new venv, so the packages every chat starts with are there
    // from its first command rather than from the next refresh.
    await linkPythonBase(venv);
  }
  return failure;
}

export function setVenvCreator(
  next: (venv: AbsolutePath, chatId: ChatId) => Promise<undefined | VenvError>,
): void {
  createVenv = next;
}

function awaitVenvCreation({
  creation,
  signal,
}: {
  creation: Promise<undefined | VenvError>;
  signal?: AbortSignal;
}) {
  if (signal === undefined) {
    return creation;
  }

  if (signal.aborted) {
    return Promise.resolve(cancelledVenvCreation());
  }

  const abortSignal = signal;
  return new Promise<undefined | VenvError>((resolve) => {
    function onAbort() {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(cancelledVenvCreation());
    }

    const finish = (result: undefined | VenvError) => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    void creation.then(finish);
  });
}

function cancelledVenvCreation(): VenvError {
  return {
    exitCode: 1,
    output: "Python environment setup was cancelled.",
  };
}

/**
 * Whether a virtualenv runs: its interpreter and config are there, and so is
 * the Python it was made from.
 */
export function hasUsableVenv(venv: AbsolutePath) {
  const config = path.join(venv, "pyvenv.cfg");
  if (!existsSync(venvPython(venv)) || !existsSync(config)) {
    return false;
  }
  // The Python the venv was made from, gone once the managed Python is
  // removed or kept somewhere else. Without it the venv runs nothing, even
  // where its own `python.exe` is still there (Windows).
  // oxlint-disable-next-line studio/no-sync-content-read -- the main thread reads a venv in the runtime folder, or one the bash worker read just before asking it to make the venv.
  const home = /^home\s*=\s*(.+)$/m.exec(readFileSync(config, "utf8"))?.[1];
  return home === undefined || existsSync(home.trim());
}

async function runUvVenv(
  venv: AbsolutePath,
  chatId: ChatId,
): Promise<undefined | VenvError> {
  const python = await ensureManagedPython();
  if (python) {
    return python;
  }
  // `--clear` because we only get here when the venv is missing or unusable,
  // so replacing whatever is there is the intent. Without it uv refuses to
  // touch an existing venv, which would strand a chat whose interpreter went
  // missing: the venv never becomes usable, so every python/pip call fails and
  // nothing in the app can recover it. uv still declines to clear a directory
  // that is not a virtual environment, so this cannot delete the chat's files.
  return runUvCommand({
    args: ["venv", "--clear", "--python", MANAGED_PYTHON_VERSION, venv],
    cwd: AbsolutePathSchema.parse(path.dirname(venv)),
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
