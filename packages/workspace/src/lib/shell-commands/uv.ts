import { type CommandContext, defineCommand } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { ensureChatVenv } from "../ensure-chat-venv";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { ensureManagedPython } from "../run-uv";
import { getUvBinPath, withPythonVersionNote } from "../uv";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext, subprocessStdin } from "./utils";

export const UV_COMMAND = {
  description:
    "Python package and environment manager, backing `python` and `pip` with a per-task virtualenv in .venv. The very first Python use fetches a managed interpreter (one-time); later uses are fast.",
  name: "uv",
} as const;

export function createUvCommand(chatId: ChatId, _layout: WorkspaceFsLayout) {
  return defineCommand(UV_COMMAND.name, async (args, ctx) => {
    const blocked = blockedSelfUpdate(args);
    if (blocked) {
      return blocked;
    }

    const { env, taskCwd } = resolveCommandContext(chatId, ctx);

    // The chat's uv may not write the managed Python, so the app installs
    // it before the first command that could look for it.
    const python = await ensureManagedPython();
    if (python) {
      return { exitCode: python.exitCode, stderr: python.output, stdout: "" };
    }

    // `uv pip` requires the venv to exist (VIRTUAL_ENV points at .venv).
    // Ensure it here so `uv pip install` works even before any `python`/`pip`
    // call has run, matching the behavior of the `pip` custom command.
    if (args[0] === "pip") {
      const venvError = await ensureVenvForCommand({ ctx, chatId });
      if (venvError !== undefined) {
        return { exitCode: 1, stderr: venvError, stdout: "" };
      }
    }

    const result = await runUv({
      args: hostPathArgs(args),
      ctx,
      env,
      taskCwd,
    });
    return result;
  });
}

/**
 * Create the task's `.venv` if it does not yet have a usable interpreter.
 * The first call (machine-wide) downloads a managed CPython, so it can take a
 * few seconds.
 */
export async function ensureVenvForCommand({
  ctx,
  chatId,
}: {
  ctx: CommandContext;
  chatId: ChatId;
}): Promise<string | undefined> {
  const result = await ensureChatVenv({ signal: ctx.signal, chatId });
  return result?.output;
}

/**
 * Run the bundled uv binary. `env` should already include the uv overlay (it is
 * merged into every command's env by resolveCommandContext).
 */
export async function runUv({
  args,
  ctx,
  env,
  taskCwd,
}: {
  args: string[];
  ctx: CommandContext;
  env: Record<string, string>;
  taskCwd: AbsolutePath;
}) {
  const stdin = subprocessStdin(ctx.stdin);
  const result = await execShim(getUvBinPath(), args, {
    cancelSignal: ctx.signal,
    cwd: taskCwd,
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
