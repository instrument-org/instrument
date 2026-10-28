import { defineCommand, latin1FromBytes } from "just-bash";

import path from "node:path";

import { FOLDER_VARIABLES } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { type ChannelAnswer, openScriptChannel } from "../capabilities/channel";
import {
  ensurePythonRuntime,
  linkPythonRuntime,
} from "../capabilities/python-runtime";
import { scriptSurfaceOpen } from "../capabilities/script-surface";
import { ensureInstrumentStub } from "../capabilities/stub";
import { filterShellOutput } from "../filter-shell-output";
import { pythonBaseDir } from "../python-base";
import {
  environmentBinDir,
  pythonLayerEnv,
  skillPythonToRun,
} from "../skill-environments";
import { venvPython } from "../uv";
import { pythonToRun } from "../venv";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { binaryStdout, mapStreams, shimOutput } from "./exec-shim";
import { runNative } from "./pipe-stage";
import { hostPathArgs, resolveCommandContext } from "./utils";

/**
 * `python` (and `python3`) is a real process held to the same native sandbox
 * as every other binary the shell runs. A script in a skill's folder runs in
 * that skill's environment, with the virtualenv nearest the shell's folder,
 * where `pip install` put packages, behind it; anything else runs in that
 * virtualenv, with the environment of the skill loaded last behind it, or
 * where there is none, in that skill's environment, or the managed Python's
 * own.
 */
export const PYTHON_COMMAND = {
  description: `Run Python as a real process: a skill's script with that skill's packages, and your own code with what \`pip\` installed in the nearest \`.venv\` up to your work folder. Each also finds the other's packages where its own have none by that name: a skill's script finds what you installed, and your code the packages of the skill you loaded last. It reads and writes the folders you reach where they sit.`,
  name: "python",
  /** What the description adds where a script reaches \`instrument\`. */
  scripting: `A script reaches connected apps with \`import instrument\`: \`instrument.app("<slug>").<tool>(...)\` calls an MCP app's tool, \`instrument.app("<slug>").get("<path>", params={...})\` (\`.post(path, body=...)\`, ...) an API app and returns the parsed body; calls are synchronous and safe from threads; \`instrument.ReadGuideFirst\` carries the guide before an app's first request. Run \`instrument\` itself only in the shell, never with \`subprocess\`.`,
} as const;

export const PYTHON3_COMMAND = {
  description: "Alias for python.",
  name: "python3",
} as const;

export function createPython3Command(
  chatId: ChatId,
  _layout: WorkspaceFsLayout,
  answerScript?: ChannelAnswer,
) {
  return createPythonCommandNamed(chatId, PYTHON3_COMMAND.name, answerScript);
}

/**
 * With `answerScript`, a script's `import instrument` reaches the shell's
 * capabilities over a loopback channel opened for that one process.
 */
export function createPythonCommand(
  chatId: ChatId,
  _layout: WorkspaceFsLayout,
  answerScript?: ChannelAnswer,
) {
  return createPythonCommandNamed(chatId, PYTHON_COMMAND.name, answerScript);
}

function createPythonCommandNamed(
  chatId: ChatId,
  name: string,
  answerScript: ChannelAnswer | undefined,
) {
  return {
    ...defineCommand(name, (args, ctx) =>
      runNativePython(chatId, name, args, ctx, answerScript),
    ),
    acceptsPipeHandoff: true,
  };
}

/** Run the interpreter for the shell's folder as a real subprocess. */
async function runNativePython(
  chatId: ChatId,
  name: string,
  args: string[],
  ctx: Parameters<Parameters<typeof defineCommand>[1]>[1],
  answerScript: ChannelAnswer | undefined,
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
  if ("error" in skill) {
    return { exitCode: 1, stderr: skill.error.output, stdout: "" };
  }
  const interpreter = skill.venv
    ? { python: venvPython(skill.venv), venv: skill.venv }
    : await pythonToRun({ chatId, cwd: hostCwd, signal: ctx.signal });
  if ("error" in interpreter) {
    return { exitCode: 1, stderr: interpreter.error.output, stdout: "" };
  }

  // The base packages every chat is pointed at. A virtualenv is given them by
  // a `.pth` written inside it (`linkPythonBase`), and the managed Python run
  // bare has no site-packages of its own to put one in, so the folder goes on
  // `PYTHONPATH` instead: the same set by the other door, so a chat's first
  // `python -c "import matplotlib"` works before anything has run `pip`.
  // `instrument` reaches a script the same two ways: a `.pth` in whichever
  // virtualenv runs, or its folders on `PYTHONPATH`, the `sitecustomize`
  // that takes the channel first.
  // With the script surface closed, `import instrument` finds nothing.
  const scripted = scriptSurfaceOpen();
  const venv = skill.venv ?? interpreter.venv;
  const bare = venv === undefined;
  const instrument = bare && scripted ? await ensurePythonRuntime() : undefined;
  if (venv !== undefined && scripted) {
    await linkPythonRuntime(venv);
  }
  const base = bare ? pythonBaseDir() : undefined;
  const pythonPath =
    [instrument?.site, instrument?.modules, base, env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter) || undefined;

  const answer = scriptSurfaceOpen() ? answerScript : undefined;
  if (answer) {
    await ensureInstrumentStub();
  }
  const scriptChannel =
    answer &&
    (await openScriptChannel((request, stageSignal) =>
      answer(request, stageSignal ?? ctx.signal),
    ));

  try {
    return await runNative(
      ctx,
      interpreter.python,
      finalArgs,
      {
        cancelSignal: ctx.signal,
        ...(scriptChannel && { scriptChannel }),
        cwd: hostCwd,
        // A skill's environment, and the one layered behind the interpreter's,
        // are what a Python the script starts finds too. The managed Python run
        // bare reads no packages of the person's own (their user
        // site-packages), as a virtualenv reads none.
        env: {
          ...env,
          ...(skill.venv
            ? {
                PATH: [environmentBinDir(skill.venv), env.PATH]
                  .filter(Boolean)
                  .join(path.delimiter),
                VIRTUAL_ENV: skill.venv,
              }
            : interpreter.venv
              ? {}
              : { PYTHONNOUSERSITE: "1" }),
          ...(pythonPath === undefined ? {} : { PYTHONPATH: pythonPath }),
          // Last, and handed what `PYTHONPATH` now holds, so a skill's layer
          // goes in front of the base set rather than over it.
          ...(skill.layer && pythonLayerEnv(skill.layer, pythonPath)),
        },
        // Buffer, not the latin1-packed string: execa UTF-8 encodes string
        // input, which would double-encode every non-ASCII byte.
        ...(stdin
          ? { input: Buffer.from(stdin, "latin1") }
          : { stdin: "ignore" as const }),
      },
      (result) => ({
        exitCode: result.exitCode ?? 1,
        ...mapStreams(shimOutput(result, name), (text) =>
          filterShellOutput(text),
        ),
        ...binaryStdout(result),
      }),
    );
  } catch (error) {
    scriptChannel?.close();
    throw error;
  }
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
