import path from "node:path";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { absolutePathJoin } from "./absolute-path-join";
import { commandLineToolsEnv } from "./command-line-tools-env";
import { uvToolsEnvFor } from "./tool-isolation-env";
import { getWorkspaceConfig } from "./workspace-config";
import { workDir } from "./work-dir";

// The chat's virtualenv, at the root of its folder so it ships with the chat
// and stays isolated from other chats. The root is also the agent's working directory,
// which is where uv and python look for a venv when nothing points them at one.
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

/** Absolute path to the task's virtualenv directory (`.venv`). */
export function chatVenvDir(chatId: ChatId): AbsolutePath {
  return absolutePathJoin(workDir(chatId), VENV_DIR_NAME);
}

/**
 * Absolute path to the venv's interpreter. uv lays out `bin/python` on unix and
 * `Scripts/python.exe` on Windows; route python/python3 here directly so they
 * share the same environment that `uv pip` installs into.
 */
export function chatVenvPython(chatId: ChatId): AbsolutePath {
  const binDir = isWindows ? "Scripts" : "bin";
  const python = isWindows ? "python.exe" : "python";
  return absolutePathJoin(chatVenvDir(chatId), binDir, python);
}

/**
 * Env overlay shared by the uv/python/pip commands and merged into the env of
 * the real-binary escape hatches (tsx/node/ffmpeg) so a script that shells out
 * to `python`/`uv` finds them on PATH. Pins uv to isolated, writable dirs under
 * userData rather than the person's home, and to a managed CPython so it never silently
 * uses a random host Python. `VIRTUAL_ENV` points uv and the interpreter at the
 * task's `.venv`.
 */
export function uvSubprocessEnv({
  chatId,
}: {
  chatId: ChatId;
}): Record<string, string> {
  const { uvBinPath, uvDataDir } = getWorkspaceConfig();
  const venvDir = chatVenvDir(chatId);

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
    // across tasks so big downloads land once and persist, rather than under
    // `~`, which the native sandbox keeps read-only outside the chat's
    // folders. We target each library's own cache
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
    VIRTUAL_ENV: venvDir,
    ...uvToolsEnvFor(uvDataDir),
    // The managed Python is the app's to install (installManagedPython), in
    // a folder no chat may write, so a chat's uv uses the one there and
    // fails plainly on any other version rather than trying a download.
    UV_PYTHON_DOWNLOADS: "never",
  };
}

/**
 * uv's `output`, with a line saying which Python there is when it failed for
 * want of another version (`uv venv --python 3.11`, a project that requires
 * 3.13).
 */
export function withPythonVersionNote(output: string): string {
  return /No interpreter found for .* in managed installations/.test(output)
    ? `${output.trimEnd()}\nOnly Python ${MANAGED_PYTHON_VERSION} is available, and no other version can be installed. Use \`--python ${MANAGED_PYTHON_VERSION}\`, or a project whose requires-python allows ${MANAGED_PYTHON_VERSION}.\n`
    : output;
}
