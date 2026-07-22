import { execa } from "execa";
import { defineCommand, latin1FromBytes } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { taskVenvPython } from "../uv";
import {
  bridgeInlineCodePaths,
  resolveCommandContext,
  resolvePathArgs,
  scanScriptFileForVirtualPaths,
} from "./utils";
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

    // Inline program text (`-c` code, or a heredoc program when python reads
    // the script from stdin) resolves paths against the host filesystem, so
    // bridge sandbox-virtual paths the same way argv paths are bridged.
    const bridgedArgs = [...args];
    let stdin = latin1FromBytes(ctx.stdin);
    const codeIndex = bridgedArgs.indexOf("-c") + 1;
    const readsProgramFromStdin =
      bridgedArgs.length === 0 ||
      (bridgedArgs.length === 1 && bridgedArgs[0] === "-");
    if (codeIndex > 0 && codeIndex < bridgedArgs.length) {
      const bridged = bridgeInlineCodePaths(
        bridgedArgs[codeIndex] ?? "",
        taskId,
        taskCwd,
      );
      if ("error" in bridged) {
        return { exitCode: 1, stderr: bridged.error, stdout: "" };
      }
      bridgedArgs[codeIndex] = bridged.code;
    } else if (stdin && readsProgramFromStdin) {
      const bridged = bridgeInlineCodePaths(stdin, taskId, taskCwd);
      if ("error" in bridged) {
        return { exitCode: 1, stderr: bridged.error, stdout: "" };
      }
      stdin = bridged.code;
    }

    const finalArgs = resolvePathArgs(bridgedArgs, taskId, ctx);

    // Scan the entry script for sandbox-virtual path literals a real interpreter
    // can't resolve, so it fails with copy-first / use-relative-paths guidance
    // instead of a confusing host-filesystem error deep in a traceback.
    const scriptIndex = pythonScriptArgIndex(bridgedArgs);
    if (scriptIndex !== undefined) {
      const scanError = await scanScriptFileForVirtualPaths(
        taskCwd,
        finalArgs[scriptIndex] ?? "",
      );
      if (scanError !== undefined) {
        return { exitCode: 1, stderr: scanError, stdout: "" };
      }
    }

    const result = await execa(taskVenvPython(taskId), finalArgs, {
      all: true,
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env,
      reject: false,
      // Buffer, not the latin1-packed string: execa UTF-8 encodes string
      // input, which would double-encode every non-ASCII byte.
      ...(stdin
        ? { input: Buffer.from(stdin, "latin1") }
        : { stdin: "ignore" }),
    });

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(result.all, taskDir(taskId)),
    };
  });
}

/**
 * Index of the first arg python runs as a script file, or undefined for module
 * (`-m`), inline (`-c`), or stdin (`-`) invocations, which have no file to scan.
 * Good enough for the common `python [flags] script.py` shape; on a miss it
 * simply skips the scan (fail-open).
 */
function pythonScriptArgIndex(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "-c" || arg === "-m" || arg === "-") {
      return undefined;
    }
    if (arg.startsWith("-")) {
      // `-W`/`-X` take the next arg as their value; skip it so it isn't
      // mistaken for the script file.
      if (arg === "-W" || arg === "-X") {
        i++;
      }
      continue;
    }
    return i;
  }
  return undefined;
}
