import { defineCommand, latin1FromBytes } from "just-bash";

import path from "node:path";

import { FOLDER_VARIABLES } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { filterShellOutput } from "../filter-shell-output";
import { environmentBinDir, skillPythonToRun } from "../skill-environments";
import { venvPython } from "../uv";
import { pythonToRun } from "../venv";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { hostPathArgs, resolveCommandContext } from "./utils";

/**
 * `python` (and `python3`) is a real process held to the same native sandbox
 * as every other binary the shell runs. A script in a skill's folder runs in
 * that skill's environment; anything else in the virtualenv nearest the
 * shell's folder, where `pip install` put packages, or where there is none,
 * the environment of the skill loaded last, or the managed Python's own.
 */
export const PYTHON_COMMAND = {
  description: `Run Python as a real process: a skill's script with that skill's packages, and anything else in the nearest \`.venv\` up to this conversation's folder, with what \`pip\` installed there, or where there is none, with the packages of the skill you loaded last, or the standard library alone. It reads and writes the folders you reach where they sit.`,
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

  const script = pythonScript(finalArgs);
  const skill = await skillPythonToRun({
    chatId,
    cwd: hostCwd,
    loadedSkillDir: env[FOLDER_VARIABLES.skill],
    script: script === undefined ? undefined : path.resolve(hostCwd, script),
    signal: ctx.signal,
  });
  if (skill && "error" in skill) {
    return { exitCode: 1, stderr: skill.error.output, stdout: "" };
  }
  const interpreter = skill
    ? { python: venvPython(skill.venv), venv: skill.venv }
    : await pythonToRun({ chatId, cwd: hostCwd, signal: ctx.signal });
  if ("error" in interpreter) {
    return { exitCode: 1, stderr: interpreter.error.output, stdout: "" };
  }

  const result = await execShim(interpreter.python, finalArgs, {
    cancelSignal: ctx.signal,
    cwd: hostCwd,
    // A skill's environment is the one a program the script starts finds
    // too. The managed Python run bare reads no packages of the person's
    // own (their user site-packages), as a virtualenv reads none.
    env: skill
      ? {
          ...env,
          PATH: [environmentBinDir(skill.venv), env.PATH]
            .filter(Boolean)
            .join(path.delimiter),
          VIRTUAL_ENV: skill.venv,
        }
      : interpreter.venv
        ? env
        : { ...env, PYTHONNOUSERSITE: "1" },
    // Buffer, not the latin1-packed string: execa UTF-8 encodes string
    // input, which would double-encode every non-ASCII byte.
    ...(stdin ? { input: Buffer.from(stdin, "latin1") } : { stdin: "ignore" }),
  });

  return {
    exitCode: result.exitCode ?? 1,
    ...mapStreams(shimOutput(result, name), (text) => filterShellOutput(text)),
  };
}

/** Options of Python's own that take the argument after them. */
const VALUE_OPTIONS = new Set(["W", "X"]);

/**
 * The script a `python` command line runs, as given: its first argument
 * that is not one of Python's own options. Undefined for code run from
 * `-c`, a module run with `-m`, or a program read from stdin.
 */
export function pythonScript(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-") {
      return undefined;
    }
    if (arg === "--") {
      return args[index + 1];
    }
    if (arg.startsWith("--")) {
      if (arg === "--check-hash-based-pycs") {
        index++;
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
    // A cluster of single-letter options (`-uB`), the last of which may
    // take a value, attached (`-Wignore`) or as the next argument.
    for (let position = 1; position < arg.length; position++) {
      const letter = arg[position] ?? "";
      if (letter === "c" || letter === "m") {
        return undefined;
      }
      if (VALUE_OPTIONS.has(letter)) {
        if (position === arg.length - 1) {
          index++;
        }
        break;
      }
    }
  }
  return undefined;
}
