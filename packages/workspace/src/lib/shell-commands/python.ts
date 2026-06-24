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
    "Run Python via the per-task virtualenv (work/.venv). Shares packages installed with `pip`. For multi-line code, write a `.py` file and run it rather than `python -c` -- the shell does not preserve leading indentation inside inline quoted strings.",
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
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const venvError = await ensureTaskVenv({ ctx, env, taskCwd, taskId });
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
