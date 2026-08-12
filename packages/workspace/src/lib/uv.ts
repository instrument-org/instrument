import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { commandLineToolsEnv } from "./command-line-tools-env";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig } from "./workspace-config";

// Per-task virtualenv lives under the runnable `work/` dir so it ships with the
// task and stays isolated from other tasks.
const VENV_DIR_NAME = ".venv";

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
    // uv reaches for install_name_tool when it relocates a managed interpreter,
    // and for a compiler if an install ever falls back to source. Both are
    // macOS Command Line Tools stubs, which hang the tool call behind an
    // installer dialog when the tools are absent.
    ...commandLineToolsEnv(),
    // Redirect heavy model/data caches to an app-managed, writable dir shared
    // across tasks so big downloads land once and persist. just-bash sets
    // HOME=/ (read-only), so libraries that cache under `~` would otherwise
    // fail with EROFS on first download. We target each library's own cache
    // var instead of overriding HOME: XDG_CACHE_HOME covers XDG-compliant libs
    // (Whisper's `~/.cache/whisper`, and HuggingFace's fallback when HF_HOME is
    // unset); HF_HOME and U2NET_HOME cover HuggingFace and rembg's `~/.u2net`,
    // which use their own vars. HOME itself stays the real host home (like
    // run-pnpm.ts) so `os.homedir()`/`Path.home()` match the tsx/node hatches
    // and stay writable, rather than resolving to a fake isolated dir.
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    HF_HOME: path.join(uvDataDir, "huggingface"),
    PATH: pathDirs.join(path.delimiter),
    TERM: "dumb",
    U2NET_HOME: path.join(uvDataDir, "u2net"),
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_NO_CONFIG: "1",
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, "python"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    VIRTUAL_ENV: venvDir,
    XDG_CACHE_HOME: path.join(uvDataDir, "cache-home"),
  };
}
