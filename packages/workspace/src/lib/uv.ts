import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig } from "./workspace-config";

// Per-task virtualenv lives under the runnable `work/` dir so it ships with the
// task and stays isolated from other tasks.
const VENV_DIR_NAME = ".venv";

// cspell:ignore numba torch scipy unbuildable rembg huggingface pyright
// Pin the managed interpreter to a stable version. Without this, uv
// (`only-managed` + `automatic` downloads) provisions the newest CPython it can
// fetch, which is too new for much of the scientific/ML ecosystem (numba, torch,
// scipy wheels lag a release or two). On a too-new interpreter uv's resolver
// silently backtracks to ancient, unbuildable deps. 3.12 matches the floor our
// skills declare (`requires-python = ">=3.11"`, pyright `3.11`).
export const MANAGED_PYTHON_VERSION = "3.12";

const isWindows = process.platform === "win32";

export function getUvBinPath(): AbsolutePath {
  return getWorkspaceConfig().uvBinPath;
}

/** Absolute path to the task's virtualenv directory (`work/.venv`). */
export function taskVenvDir(taskId: TaskId): AbsolutePath {
  return absolutePathJoin(
    taskDir(taskId),
    TASK_FOLDER_NAMES.work,
    VENV_DIR_NAME,
  );
}

/**
 * Absolute path to the venv's interpreter. uv lays out `bin/python` on unix and
 * `Scripts/python.exe` on Windows; route python/python3 here directly so they
 * share the same environment that `uv pip` installs into.
 */
export function taskVenvPython(taskId: TaskId): AbsolutePath {
  const binDir = isWindows ? "Scripts" : "bin";
  const python = isWindows ? "python.exe" : "python";
  return absolutePathJoin(taskVenvDir(taskId), binDir, python);
}

/**
 * Env overlay shared by the uv/python/pip commands and merged into the env of
 * the real-binary escape hatches (tsx/node/ffmpeg) so a script that shells out
 * to `python`/`uv` finds them on PATH. Pins uv to isolated, writable dirs under
 * userData (just-bash sets `HOME=/`, which would otherwise send uv writing to
 * the host fs, see run-pnpm.ts) and to a managed CPython so it never silently
 * uses a random host Python. `VIRTUAL_ENV` points uv and the interpreter at the
 * task's `work/.venv`.
 */
export function uvSubprocessEnv({
  taskId,
}: {
  taskId: TaskId;
}): Record<string, string> {
  const { uvBinPath, uvDataDir } = getWorkspaceConfig();
  const venvDir = taskVenvDir(taskId);

  const pathDirs = [
    path.dirname(uvBinPath),
    path.join(venvDir, isWindows ? "Scripts" : "bin"),
    ...(process.env.PATH ? [process.env.PATH] : []),
  ];

  return {
    PATH: pathDirs.join(path.delimiter),
    // just-bash sets HOME=/ (read-only), so libraries that cache under `~`
    // (HuggingFace `~/.cache/huggingface`, Whisper `~/.cache/whisper`, rembg
    // `~/.u2net`) fail with EROFS on first model download. Point HOME at an
    // app-managed, writable dir shared across tasks so those caches land once
    // and persist. uv itself is unaffected (it uses the explicit UV_* dirs).
    HOME: path.join(uvDataDir, "home"),
    TERM: "dumb",
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_NO_CONFIG: "1",
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, "python"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    VIRTUAL_ENV: venvDir,
  };
}
