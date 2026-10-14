import { type CommandContext, defineCommand } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { ensureManagedPython } from "../run-uv";
import { getUvBinPath, withPythonVersionNote } from "../uv";
import { venvToInstallInto } from "../venv";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

export const UV_COMMAND = {
  description:
    "Python package and environment manager, backing `python` and `pip`. The very first Python use fetches a managed interpreter (one-time); later uses are fast.",
  name: "uv",
} as const;

export function createUvCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return defineCommand(UV_COMMAND.name, async (args, ctx) => {
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
    const result = await runUv({
      args: hostPathArgs(args),
      ctx,
      env,
      hostCwd,
    });
    return result;
  });
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
}: {
  args: string[];
  ctx: CommandContext;
  env: Record<string, string>;
  hostCwd: AbsolutePath;
}) {
  const stdin = subprocessStdin(ctx.stdin);
  const result = await execShim(getUvBinPath(), args, {
    cancelSignal: ctx.signal,
    cwd: hostCwd,
    env,
    ...(stdin ? { input: stdin } : { stdin: "ignore" }),
  });
  return {
    exitCode: result.exitCode ?? 1,
    ...mapStreams(shimOutput(result, UV_COMMAND.name), (text) =>
      withPythonVersionNote(filterShellOutput(text)),
    ),
  };
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
