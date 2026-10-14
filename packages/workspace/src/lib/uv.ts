import { existsSync } from "node:fs";
import path from "node:path";

import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { absolutePathJoin } from "./absolute-path-join";
import { hostPathWithin } from "./host-path";
import { runtimeLayout } from "./runtime-dir";
import { uvToolsEnvFor } from "./tool-isolation-env";
import { getWorkspaceConfig } from "./workspace-config";
import { workDir } from "./work-dir";

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

/**
 * The virtualenv at the root of the chat's work folder, which the first
 * `pip install` with none nearer makes, and which a loaded skill's Python
 * dependencies install into.
 */
export function workVenvDir(chatId: ChatId): AbsolutePath {
  return absolutePathJoin(workDir(chatId), VENV_DIR_NAME);
}

/**
 * A virtualenv's interpreter: `bin/python` on macOS and Linux,
 * `Scripts/python.exe` on Windows, as uv lays them out.
 */
export function venvPython(venvDir: AbsolutePath): AbsolutePath {
  return isWindows
    ? absolutePathJoin(venvDir, "Scripts", "python.exe")
    : absolutePathJoin(venvDir, "bin", "python");
}

/**
 * The virtualenv a Python command run in `cwd` uses: the nearest `.venv`
 * from `cwd` up to the root of the chat's work folder, and for a command run
 * outside that folder, the one at its root. Undefined where there is none.
 */
export function nearestVenv(
  chatId: ChatId,
  cwd: string,
): AbsolutePath | undefined {
  const root = workDir(chatId);
  const within = hostPathWithin(root, cwd);
  const segments = within === null ? [] : within.split("/").filter(Boolean);
  for (let depth = segments.length; depth >= 0; depth--) {
    const venv = path.join(root, ...segments.slice(0, depth), VENV_DIR_NAME);
    if (existsSync(path.join(venv, "pyvenv.cfg"))) {
      return AbsolutePathSchema.parse(venv);
    }
  }
  return undefined;
}

/**
 * Env overlay shared by the uv/python/pip commands and merged into the env of
 * the real-binary escape hatches (tsx/node/ffmpeg) so a script that shells out
 * to `python`/`uv` finds them on PATH. Pins uv to isolated, writable dirs under
 * userData rather than the person's home, and to a managed CPython so it never silently
 * uses a random host Python. `VIRTUAL_ENV` points uv and the interpreter at the
 * virtualenv nearest `cwd`, where there is one.
 */
export function uvSubprocessEnv({
  chatId,
  cwd,
}: {
  chatId: ChatId;
  /** The command's working folder, on the host. */
  cwd: string;
}): Record<string, string> {
  const { runtimeDir, uvBinPath } = getWorkspaceConfig();
  const { caches } = runtimeLayout(runtimeDir);
  const venvDir = nearestVenv(chatId, cwd);

  const pathDirs = [
    path.dirname(uvBinPath),
    ...(venvDir ? [path.join(venvDir, isWindows ? "Scripts" : "bin")] : []),
    ...(process.env.PATH ? [process.env.PATH] : []),
  ];

  return {
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
    HF_HOME: path.join(caches, "huggingface"),
    PATH: pathDirs.join(path.delimiter),
    TERM: "dumb",
    U2NET_HOME: path.join(caches, "u2net"),
    ...(venvDir ? { VIRTUAL_ENV: venvDir } : {}),
    ...uvToolsEnvFor(runtimeDir),
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
