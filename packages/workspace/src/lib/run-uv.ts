import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { commandLineToolsEnv } from "./command-line-tools-env";
import { filterShellOutput } from "./filter-shell-output";
import { inheritedEnv } from "./native-env";
import { chatNativeReach } from "./chat-native-reach";
import {
  NativeSandboxUnavailableError,
  withInstallerClosed,
  wrapNativeCommand,
} from "./native-sandbox";
import { uvToolsEnvFor } from "./tool-isolation-env";
import {
  getUvBinPath,
  MANAGED_PYTHON_VERSION,
  uvSubprocessEnv,
  withPythonVersionNote,
} from "./uv";
import { getWorkspaceConfig } from "./workspace-config";

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
  const { UV_EXCLUDE_NEWER, ...pinnedEnv } = uvSubprocessEnv({ chatId });
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
    // Into uv's data folder alone: no `python3.12` in ~/.local/bin, and
    // nothing in the Windows registry, where the person's own tools would
    // find it.
    "--no-bin",
    "--no-registry",
    MANAGED_PYTHON_VERSION,
  ]);
  const result = await execa(spawned.file, spawned.args, {
    all: true,
    env: {
      ...inheritedEnv(),
      ...commandLineToolsEnv(),
      ...uvToolsEnvFor(getWorkspaceConfig().uvDataDir),
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
