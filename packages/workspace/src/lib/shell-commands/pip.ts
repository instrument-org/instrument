import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { resolveCommandContext, resolvePathArgs } from "./utils";
import { ensureTaskVenv, runUv } from "./uv";

// `pip` (and the `pip3` alias) route through `uv pip`, which installs into the
// task venv (work/.venv) without needing pip seeded into the env. `uv pip`
// honors VIRTUAL_ENV, set by the uv env overlay.
export const PIP_COMMAND = {
  description:
    "Install Python packages into the per-task virtualenv (work/.venv) via uv. Use like pip, e.g. `pip install <package>`.",
  name: "pip",
} as const;

export const PIP3_COMMAND = {
  description: "Alias for pip.",
  name: "pip3",
} as const;

export function createPip3Command(taskId: TaskId) {
  return createPipCommandNamed(taskId, PIP3_COMMAND.name);
}

export function createPipCommand(taskId: TaskId) {
  return createPipCommandNamed(taskId, PIP_COMMAND.name);
}

function createPipCommandNamed(taskId: TaskId, name: string) {
  return defineCommand(name, async (args, ctx) => {
    // `uv pip --version` is not a valid uv subcommand; intercept and return a
    // pip-compatible version string so agents that probe with `pip --version`
    // get a useful response rather than a confusing uv usage error.
    if (args[0] === "--version" || args[0] === "-V") {
      const { env, taskCwd } = resolveCommandContext(taskId, ctx);
      const uvResult = await runUv({
        args: ["--version"],
        ctx,
        env,
        taskCwd,
        taskId,
      });
      const uvVersion = uvResult.stdout.trim();
      return {
        exitCode: 0,
        stderr: "",
        stdout: `pip (via uv; ${uvVersion}) from work/.venv\n`,
      };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const venvError = await ensureTaskVenv({ ctx, env, taskCwd, taskId });
    if (venvError !== undefined) {
      return { exitCode: 1, stderr: "", stdout: venvError };
    }

    const result = await runUv({
      args: ["pip", ...resolvePathArgs(args, taskId, ctx)],
      ctx,
      env,
      taskCwd,
      taskId,
    });
    return { exitCode: result.exitCode, stderr: "", stdout: result.stdout };
  });
}
