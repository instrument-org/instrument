import { defineCommand, latin1FromBytes } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { pythonToRun } from "../venv";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext } from "./utils";

/**
 * `python` (and `python3`) is the interpreter in the virtualenv nearest the
 * shell's folder, where `pip install` put packages, or the managed Python's
 * own where there is none: a real process held to the same native sandbox
 * as every other binary the shell runs.
 */
export const PYTHON_COMMAND = {
  description: `Run Python as a real process: in the nearest \`.venv\` up to this conversation's folder, with what \`pip\` installed there, or with the standard library alone. It reads and writes the folders you reach where they sit.`,
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

/** Run the interpreter for the shell's folder as a real subprocess. */
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

  const { env, hostCwd } = resolveCommandContext(chatId, ctx);
  const finalArgs = hostPathArgs(args);
  const stdin = latin1FromBytes(ctx.stdin);

  const interpreter = await pythonToRun({
    chatId,
    cwd: hostCwd,
    signal: ctx.signal,
  });
  if ("error" in interpreter) {
    return { exitCode: 1, stderr: interpreter.error.output, stdout: "" };
  }

  const result = await execShim(interpreter.python, finalArgs, {
    cancelSignal: ctx.signal,
    cwd: hostCwd,
    // The managed Python run bare reads no packages of the person's own
    // (their user site-packages), as a virtualenv reads none.
    env: interpreter.venv ? env : { ...env, PYTHONNOUSERSITE: "1" },
    // Buffer, not the latin1-packed string: execa UTF-8 encodes string
    // input, which would double-encode every non-ASCII byte.
    ...(stdin ? { input: Buffer.from(stdin, "latin1") } : { stdin: "ignore" }),
  });

  return {
    exitCode: result.exitCode ?? 1,
    ...mapStreams(shimOutput(result, name), (text) => filterShellOutput(text)),
  };
}
