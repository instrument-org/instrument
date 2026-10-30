import { type CommandContext, defineCommand } from "just-bash";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { ensureManagedPython } from "../run-uv";
import {
  ensurePythonEnvironment,
  environmentBinDir,
  pythonEnvironmentOf,
  pythonLayerEnv,
  trustedSkillFolder,
} from "../skill-environments";
import { getUvBinPath, nearestVenv, withPythonVersionNote } from "../uv";
import { venvToInstallInto } from "../venv";
import { binaryStdout, mapStreams, shimOutput } from "./exec-shim";
import { runNative } from "./pipe-stage";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

export const UV_COMMAND = {
  description:
    "Python package and environment manager, backing `python` and `pip`. The very first Python use fetches a managed interpreter (one-time); later uses are fast.",
  name: "uv",
} as const;

export function createUvCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  const command = defineCommand(UV_COMMAND.name, async (args, ctx) => {
    const blocked = blockedSelfUpdate(args);
    if (blocked) {
      return blocked;
    }

    // The chat's uv may not write the managed Python, so the app installs
    // it before the first command that could look for it.
    const python = await ensureManagedPython();
    if (python) {
      return { exitCode: python.exitCode, stderr: python.output, stdout: "" };
    }

    // `uv pip` installs into a venv, so one is made where there is none,
    // as the `pip` command makes one.
    if (args[0] === "pip") {
      const venvError = await installVenvError({ chatId, ctx });
      if (venvError !== undefined) {
        return { exitCode: 1, stderr: venvError, stdout: "" };
      }
    }

    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const finalArgs = hostPathArgs(args);
    const skill = await skillProjectEnvironment({
      args: finalArgs,
      chatId,
      ctx,
      hostCwd,
    });
    if (skill && "error" in skill) {
      return { exitCode: 1, stderr: skill.error, stdout: "" };
    }
    const result = await runUv({
      args: finalArgs,
      ctx,
      env: skill
        ? {
            ...env,
            PATH: [environmentBinDir(skill.venv), env.PATH]
              .filter(Boolean)
              .join(path.delimiter),
            UV_NO_SYNC: "1",
            UV_PROJECT_ENVIRONMENT: skill.venv,
            VIRTUAL_ENV: skill.venv,
            ...(skill.layer && pythonLayerEnv(skill.layer, env.PYTHONPATH)),
          }
        : env,
      hostCwd,
    });
    return result;
  });
  return { ...command, acceptsPipeHandoff: true };
}

export const UVX_COMMAND = {
  description:
    "Runs a Python command-line tool from a package without installing it, as `uv tool run`.",
  name: "uvx",
} as const;

/**
 * `uvx` as the app's own uv runs it (`uv tool run`), with the same managed
 * Python and folders, rather than whatever `uvx` is on the PATH, which
 * looks for its own `uv` beside it.
 */
export function createUvxCommand(chatId: ChatId) {
  const command = defineCommand(UVX_COMMAND.name, async (args, ctx) => {
    const python = await ensureManagedPython();
    if (python) {
      return { exitCode: python.exitCode, stderr: python.output, stdout: "" };
    }
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    return runUv({
      args: ["tool", "run", ...hostPathArgs(args)],
      ctx,
      env,
      hostCwd,
      name: UVX_COMMAND.name,
    });
  });
  return { ...command, acceptsPipeHandoff: true };
}

/**
 * For `uv run --project <skill folder>`, the skill's own environment, which
 * no chat may write, so uv runs in it as it stands (`UV_NO_SYNC`, which
 * leaves the lockfile alone too) rather than making a `.venv` in the
 * skill's folder, with the `.venv` nearest the shell's folder layered
 * behind it, as `python` runs the skill's scripts. Undefined for any other
 * command.
 */
async function skillProjectEnvironment({
  args,
  chatId,
  ctx,
  hostCwd,
}: {
  args: string[];
  chatId: ChatId;
  ctx: CommandContext;
  hostCwd: AbsolutePath;
}): Promise<
  { error: string } | { layer?: AbsolutePath; venv: AbsolutePath } | undefined
> {
  if (args[0] !== "run") {
    return undefined;
  }
  const project = projectArg(args);
  const folder =
    project === undefined
      ? undefined
      : trustedSkillFolder(path.resolve(hostCwd, project));
  if (
    folder === undefined ||
    (await pythonEnvironmentOf(folder)) === undefined
  ) {
    return undefined;
  }
  const built = await ensurePythonEnvironment({
    chatId,
    signal: ctx.signal,
    skillDir: folder,
  });
  if ("error" in built) {
    return { error: built.error.output };
  }
  const layer = nearestVenv(chatId, hostCwd);
  return layer === undefined ? built : { layer, venv: built.venv };
}

/** The folder `--project` or `--directory` names, before any `--`. */
function projectArg(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      return undefined;
    }
    for (const option of ["--project", "--directory"]) {
      if (arg === option) {
        return args[index + 1];
      }
      if (arg.startsWith(`${option}=`)) {
        return arg.slice(option.length + 1);
      }
    }
  }
  return undefined;
}

/**
 * Makes the virtualenv an install from the shell's folder goes into, where
 * there is none near, and says why when it could not. The first one on this
 * computer waits for the managed Python to download, a few seconds.
 */
export async function installVenvError({
  chatId,
  ctx,
}: {
  chatId: ChatId;
  ctx: CommandContext;
}): Promise<string | undefined> {
  const result = await venvToInstallInto({
    chatId,
    cwd: resolveCommandContext(chatId, ctx).hostCwd,
    signal: ctx.signal,
  });
  return "error" in result ? result.error.output : undefined;
}

/**
 * Run the bundled uv binary. `env` should already include the uv overlay (it is
 * merged into every command's env by resolveCommandContext).
 */
export async function runUv({
  args,
  ctx,
  env,
  hostCwd,
  name = UV_COMMAND.name,
}: {
  args: string[];
  ctx: Pick<
    CommandContext,
    "offerPipeHandoff" | "signal" | "stdin" | "stdinHandoff"
  >;
  env: Record<string, string>;
  hostCwd: AbsolutePath;
  /** The command the agent typed, which a diagnostic names. */
  name?: string;
}) {
  const stdin = subprocessStdin(ctx.stdin);
  return runNative(
    ctx,
    getUvBinPath(),
    args,
    {
      cancelSignal: ctx.signal,
      cwd: hostCwd,
      env,
      ...(stdin ? { input: stdin } : { stdin: "ignore" as const }),
    },
    (result) => ({
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, name), (text) =>
        withPythonVersionNote(filterShellOutput(text)),
      ),
      ...binaryStdout(result),
    }),
  );
}

// `uv self update` would mutate the app-managed binary; block it like pnpm
// blocks store/publish. Everything else passes through.
function blockedSelfUpdate(args: string[]) {
  if (args[0] === "self" && args[1] === "update") {
    return {
      exitCode: 1,
      stderr:
        "'uv self update' is not allowed; the bundled uv version is managed by the app.\n",
      stdout: "",
    };
  }
  return;
}
