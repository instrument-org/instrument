import { execa } from "execa";
import { defineCommand, latin1FromBytes } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { taskVenvPython } from "../uv";
import { resolveCommandContext, resolvePathArgs } from "./utils";
import { ensureTaskVenv } from "./uv";

// Both `python` and `python3` resolve to the per-task venv interpreter so they
// share the environment `pip` (uv pip) installs into.
export const PYTHON_COMMAND = {
  description:
    "Run Python via the per-task virtualenv (work/.venv). Shares packages installed with `pip`. Use the `pip` command to install packages: `python -m pip` is not available.",
  name: "python",
} as const;

export const PYTHON3_COMMAND = {
  description: "Alias for python.",
  name: "python3",
} as const;

export function createPython3Command(taskId: TaskId) {
  return createPythonCommandNamed(taskId, PYTHON3_COMMAND.name);
}

export function createPythonCommand(taskId: TaskId) {
  return createPythonCommandNamed(taskId, PYTHON_COMMAND.name);
}

function createPythonCommandNamed(taskId: TaskId, name: string) {
  return defineCommand(name, async (args, ctx) => {
    // Catch `python -m pip` before hitting the interpreter; the venv has no
    // seeded pip module, so it would fail with "No module named pip". Direct
    // the agent to the `pip` command instead.
    if (args[0] === "-m" && args[1] === "pip") {
      return {
        exitCode: 1,
        stderr: "",
        stdout:
          "`python -m pip` is not available (pip is not seeded in the venv). Use the `pip` command instead, e.g. `pip install <package>`.\n",
      };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const venvError = await ensureTaskVenv({ ctx, taskId });
    if (venvError !== undefined) {
      return { exitCode: 1, stderr: "", stdout: venvError };
    }

    const stdin = latin1FromBytes(ctx.stdin);
    const result = await execa(
      taskVenvPython(taskId),
      resolvePathArgs(args, taskId, ctx),
      {
        all: true,
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env,
        reject: false,
        ...(stdin ? { input: stdin } : { stdin: "ignore" }),
      },
    );

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(result.all, taskDir(taskId)),
    };
  });
}
