import { execa } from "execa";
import { existsSync } from "node:fs";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { filterShellOutput } from "./filter-shell-output";
import { inheritedEnv } from "./native-env";
import { chatNativeReach } from "./chat-native-reach";
import {
  NativeSandboxUnavailableError,
  withInstallerClosed,
  wrapNativeCommand,
} from "./native-sandbox";
import { runtimeLayout } from "./runtime-dir";
import { uvToolsEnvFor } from "./tool-isolation-env";
import {
  getUvBinPath,
  MANAGED_PYTHON_VERSION,
  uvSubprocessEnv,
  withPythonVersionNote,
} from "./uv";
import { getWorkspaceConfig } from "./workspace-config";
import { workDir } from "./work-dir";

export async function runUvCommand({
  args,
  cwd,
  lockfilePinned = false,
  signal,
  stdin,
  chatId,
}: {
  args: string[];
  cwd?: AbsolutePath;
  /**
   * Whether the versions come from a lockfile someone already chose them
   * in (a skill's own uv.lock), which the week-old release gate would
   * refuse to read whenever it pins a newer release.
   */
  lockfilePinned?: boolean;
  signal?: AbortSignal;
  stdin?: string;
  chatId: ChatId;
}) {
  const { UV_EXCLUDE_NEWER, ...pinnedEnv } = uvSubprocessEnv({
    chatId,
    cwd: cwd ?? workDir(chatId),
  });
  // Held to the chat's reach like any command of its own: uv runs the
  // chat's virtualenv interpreter to read it, and that interpreter, with the
  // `.pth` files beside it, is the chat's to change.
  let spawned: ReturnType<typeof wrapNativeCommand>;
  try {
    spawned = wrapNativeCommand(
      getUvBinPath(),
      args,
      (await chatNativeReach(chatId)) ?? null,
    );
  } catch (error) {
    if (error instanceof NativeSandboxUnavailableError) {
      return { combined: error.message, exitCode: 126, stdout: "" };
    }
    throw error;
  }
  const result = await execa(spawned.file, spawned.args, {
    all: true,
    cancelSignal: signal,
    cwd,
    env: {
      ...inheritedEnv(process.env, spawned.reach),
      ...(lockfilePinned ? pinnedEnv : { ...pinnedEnv, UV_EXCLUDE_NEWER }),
    },
    extendEnv: false,
    reject: false,
    ...(stdin === undefined ? { stdin: "ignore" } : { input: stdin }),
  });

  return {
    combined: withPythonVersionNote(
      filterShellOutput(
        result.all ||
          result.shortMessage ||
          "uv failed without diagnostic output.",
      ),
    ),
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
  };
}

type ManagedPythonFailure = { exitCode: number; output: string };

let managedPython: Promise<ManagedPythonFailure | undefined> | undefined;

/**
 * Installs the managed Python every chat's virtualenv is made from, once a
 * run of the app, and says why when it could not. The app does it rather
 * than a chat's uv, since that folder is read-only to every chat.
 */
export function ensureManagedPython(): Promise<
  ManagedPythonFailure | undefined
> {
  managedPython ??= installManagedPython()
    .then((result): ManagedPythonFailure | undefined =>
      result.exitCode === 0
        ? undefined
        : { exitCode: result.exitCode, output: result.combined },
    )
    .catch((error: unknown) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }))
    .then((failure) => {
      // A failure (offline, say) is tried again by the next command.
      if (failure) {
        managedPython = undefined;
      }
      return failure;
    });
  return managedPython;
}

let managedInterpreter: string | undefined;

/**
 * The managed Python's interpreter, where `managedPythonInterpreter` has
 * found it.
 */
export function foundManagedPython(): string | undefined {
  return managedInterpreter;
}

/**
 * The managed Python's own interpreter, which `python` runs where no
 * virtualenv is near: installed first when it is not, and asked of uv,
 * which knows where it keeps it. Remembered once found.
 */
export async function managedPythonInterpreter(): Promise<
  ManagedPythonFailure | { path: string }
> {
  const failure = await ensureManagedPython();
  if (failure) {
    return failure;
  }
  if (managedInterpreter !== undefined && existsSync(managedInterpreter)) {
    return { path: managedInterpreter };
  }
  const { runtimeDir } = getWorkspaceConfig();
  const spawned = withInstallerClosed(getUvBinPath(), [
    "python",
    "find",
    "--no-project",
    MANAGED_PYTHON_VERSION,
  ]);
  // From the Pythons' own folder, with no virtualenv in the environment, so
  // uv answers with the managed interpreter rather than one a project or a
  // `.venv` beside it would pick.
  const result = await execa(spawned.file, spawned.args, {
    all: true,
    cwd: runtimeLayout(runtimeDir).python,
    env: {
      ...inheritedEnv(),
      ...uvToolsEnvFor(runtimeDir),
      UV_PYTHON_DOWNLOADS: "never",
    },
    extendEnv: false,
    reject: false,
    stdin: "ignore",
  });
  if (result.exitCode !== 0) {
    return {
      exitCode: result.exitCode ?? 1,
      output: withPythonVersionNote(
        filterShellOutput(
          result.all ||
            result.shortMessage ||
            "uv failed without diagnostic output.",
        ),
      ),
    };
  }
  managedInterpreter = result.stdout.trim();
  return { path: managedInterpreter };
}

/**
 * `uv python install`, run as the app outside any chat's reach, which is
 * safe because it runs none of a chat's code: only the Command Line Tools
 * installer is closed to it, as uv may reach for `install_name_tool`. An
 * installed Python makes it a no-op of about 50 ms.
 */
async function installManagedPython() {
  const spawned = withInstallerClosed(getUvBinPath(), [
    "python",
    "install",
    // Into the runtime folder's `python/` alone: no `python3.12` in
    // ~/.local/bin, and nothing in the Windows registry, where the person's
    // own tools would find it.
    "--no-bin",
    "--no-registry",
    MANAGED_PYTHON_VERSION,
  ]);
  const result = await execa(spawned.file, spawned.args, {
    all: true,
    env: {
      ...inheritedEnv(),
      ...uvToolsEnvFor(getWorkspaceConfig().runtimeDir),
    },
    extendEnv: false,
    reject: false,
    stdin: "ignore",
  });
  return {
    combined: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
    ),
    exitCode: result.exitCode ?? 1,
  };
}
