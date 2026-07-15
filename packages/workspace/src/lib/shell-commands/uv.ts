import { execa } from "execa";
import { type CommandContext, defineCommand, latin1FromBytes } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { ensureTaskVenvForTask } from "../ensure-task-venv";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getUvBinPath } from "../uv";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const UV_COMMAND = {
  description:
    "Python package and environment manager. Also provides `python`, `python3`, and `pip`, backed by a per-task virtualenv in work/.venv. The very first Python use fetches a managed interpreter (one-time); later uses are fast.",
  name: "uv",
} as const;

export function createUvCommand(taskId: TaskId) {
  return defineCommand(UV_COMMAND.name, async (args, ctx) => {
    const blocked = blockedSelfUpdate(args);
    if (blocked) {
      return blocked;
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    // `uv pip` requires the venv to exist (VIRTUAL_ENV points at work/.venv).
    // Ensure it here so `uv pip install` works even before any `python`/`pip`
    // call has run, matching the behavior of the `pip` custom command.
    if (args[0] === "pip") {
      const venvError = await ensureTaskVenv({ ctx, taskId });
      if (venvError !== undefined) {
        return { exitCode: 1, stderr: "", stdout: venvError };
      }
    }

    const result = await runUv({
      args: resolvePathArgs(args, taskId, ctx),
      ctx,
      env,
      taskCwd,
      taskId,
    });
    return { exitCode: result.exitCode, stderr: "", stdout: result.stdout };
  });
}

/**
 * Create the task's `work/.venv` if it does not yet have a usable interpreter.
 * The first call (machine-wide) downloads a managed CPython, so it can take a
 * few seconds.
 */
export async function ensureTaskVenv({
  ctx,
  taskId,
}: {
  ctx: CommandContext;
  taskId: TaskId;
}): Promise<string | undefined> {
  const result = await ensureTaskVenvForTask({ signal: ctx.signal, taskId });
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
  taskId,
}: {
  args: string[];
  ctx: CommandContext;
  env: Record<string, string>;
  taskCwd: AbsolutePath;
  taskId: TaskId;
}) {
  const result = await execa(getUvBinPath(), args, {
    all: true,
    cancelSignal: ctx.signal,
    cwd: taskCwd,
    env,
    reject: false,
    ...(latin1FromBytes(ctx.stdin)
      ? { input: latin1FromBytes(ctx.stdin) }
      : { stdin: "ignore" }),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: filterShellOutput(result.all, taskDir(taskId)),
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
