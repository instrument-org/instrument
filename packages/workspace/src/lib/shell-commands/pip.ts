import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { PYTHON_COMMAND, PYTHON_NATIVE_COMMAND } from "./python";
import {
  resolveCommandContext,
  resolvePathArgs,
  unreachablePathArgError,
} from "./utils";
import { ensureTaskVenv, runUv } from "./uv";

// `pip` (and the `pip3` alias) route through `uv pip`, which installs into the
// task venv (.venv) without needing pip seeded into the env. `uv pip`
// honors VIRTUAL_ENV, set by the uv env overlay.
export const PIP_COMMAND = {
  description: `Install Python packages into the per-task virtualenv (.venv) via uv. Use like pip, e.g. \`pip install <package>\`. What it installs runs under \`${PYTHON_NATIVE_COMMAND.name}\`; the sandboxed \`${PYTHON_COMMAND.name}\` cannot import it.`,
  name: "pip",
} as const;

/**
 * Said after every successful install, because the trap is three commands
 * downstream: `pip install requests && python -c "import requests"` fails,
 * and the failure names the import rather than the interpreter.
 */
const INSTALLED_NOTE = `pip: installed into the task's virtualenv. Run code that imports it with \`${PYTHON_NATIVE_COMMAND.name}\`; the default \`${PYTHON_COMMAND.name}\` is the sandboxed interpreter and has the standard library only.\n`;

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
        stdout: `pip (via uv; ${uvVersion}) from .venv\n`,
      };
    }

    const unreachable = unreachablePathArgError(name, args, ctx.cwd);
    if (unreachable !== undefined) {
      return { exitCode: 1, stderr: unreachable, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const venvError = await ensureTaskVenv({ ctx, taskId });
    if (venvError !== undefined) {
      return { exitCode: 1, stderr: venvError, stdout: "" };
    }

    const result = await runUv({
      args: ["pip", ...resolvePathArgs(args, taskId, ctx)],
      ctx,
      env,
      taskCwd,
      taskId,
    });
    if (result.exitCode === 0 && args[0] === "install") {
      return { ...result, stderr: result.stderr + INSTALLED_NOTE };
    }
    return result;
  });
}
