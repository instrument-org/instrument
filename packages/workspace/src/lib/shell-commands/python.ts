import { defineCommand, latin1FromBytes } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { taskVenvPython } from "../uv";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext } from "./utils";
import { ensureTaskVenv } from "./uv";

/**
 * `python` (and `python3`) is the interpreter in the chat's virtualenv, a real
 * process held to the same native sandbox as every other binary the shell
 * runs. It is where `pip install` puts packages, so a script imports what was
 * installed.
 */
export const PYTHON_COMMAND = {
  description: `Run Python as a real process in the per-task virtualenv (.venv), with the standard library and whatever \`pip\` installed. It reads and writes the folders you reach where they sit.`,
  name: "python",
} as const;

export const PYTHON3_COMMAND = {
  description: "Alias for python.",
  name: "python3",
} as const;

export function createPython3Command(
  chatId: ChatId,
  _layout: WorkspaceFsLayout,
) {
  return createPythonCommandNamed(chatId, PYTHON3_COMMAND.name);
}

export function createPythonCommand(
  chatId: ChatId,
  _layout: WorkspaceFsLayout,
) {
  return createPythonCommandNamed(chatId, PYTHON_COMMAND.name);
}

function createPythonCommandNamed(chatId: ChatId, name: string) {
  return defineCommand(name, (args, ctx) =>
    runNativePython(chatId, name, args, ctx),
  );
}

/** Run the interpreter in the task's virtualenv as a real subprocess. */
async function runNativePython(
  chatId: ChatId,
  name: string,
  args: string[],
  ctx: Parameters<Parameters<typeof defineCommand>[1]>[1],
) {
  // Catch `python -m pip` before hitting the interpreter; the venv has no
  // seeded pip module, so it would fail with "No module named pip". Direct
  // the agent to the `pip` command instead.
  if (args[0] === "-m" && args[1] === "pip") {
    return {
      exitCode: 1,
      stderr: `\`${name} -m pip\` is not available (pip is not seeded in the venv). Use the \`pip\` command instead, e.g. \`pip install <package>\`.\n`,
      stdout: "",
    };
  }

  const { env, taskCwd } = resolveCommandContext(chatId, ctx);
  const finalArgs = hostPathArgs(args);
  const stdin = latin1FromBytes(ctx.stdin);

  const venvError = await ensureTaskVenv({ ctx, chatId });
  if (venvError !== undefined) {
    return { exitCode: 1, stderr: venvError, stdout: "" };
  }

  const result = await execShim(taskVenvPython(chatId), finalArgs, {
    cancelSignal: ctx.signal,
    cwd: taskCwd,
    env,
    // Buffer, not the latin1-packed string: execa UTF-8 encodes string
    // input, which would double-encode every non-ASCII byte.
    ...(stdin ? { input: Buffer.from(stdin, "latin1") } : { stdin: "ignore" }),
  });

  return {
    exitCode: result.exitCode ?? 1,
    ...mapStreams(shimOutput(result, name), (text) => filterShellOutput(text)),
  };
}
