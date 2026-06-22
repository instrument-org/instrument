import { execa } from "execa";
import { defineCommand, latin1FromBytes } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { TS_COMMAND } from "./ts";
import {
  extractFileAndScriptArgs,
  firstString,
  parseScriptRunnerArgs,
  resolveCommandContext,
  stringArray,
} from "./utils";

function execNode(
  taskId: TaskId,
  args: string[],
  signal?: AbortSignal,
  cwd?: AbsolutePath,
  env?: Record<string, string>,
  stdin?: string,
) {
  return execa(process.execPath, args, {
    all: true,
    cancelSignal: signal,
    cwd: cwd ?? taskDir(taskId),
    env: {
      ...getWorkspaceConfig().nodeExecEnv,
      ...env,
      // After ...env so the ffmpeg dirs win over ctx.env's host PATH.
      ...ffmpegSubprocessEnv(),
    },
    reject: false,
    ...(stdin ? { input: stdin } : { stdin: "ignore" }),
  });
}

const KNOWN_OPTIONS = {
  e: { type: "string" },
  eval: { type: "string" },
  import: { multiple: true, type: "string" },
  "input-type": { type: "string" },
  "max-old-space-size": { type: "string" },
  require: { multiple: true, type: "string" },
  v: { type: "boolean" },
  version: { type: "boolean" },
} as const;

export const NODE_COMMAND = {
  description:
    "Run a JavaScript file with Node.js. In -e: relative paths resolve from cwd; avoid absolute paths like /tmp/file — they hit the real root, not the task root.",
  name: "node",
} as const;

export function createNodeCommand(taskId: TaskId) {
  return defineCommand(NODE_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    if (args.length === 0) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} command requires a file argument or -e <code>. Prefer \`${TS_COMMAND.name}\` for TypeScript files.`,
        stdout: "",
      };
    }

    const { positionals, values } = parseScriptRunnerArgs(
      NODE_COMMAND.name,
      args,
      KNOWN_OPTIONS,
    );

    const isVersion = values.v === true || values.version === true;

    if (isVersion) {
      const execResult = await execNode(
        taskId,
        ["--version"],
        ctx.signal,
        taskCwd,
        env,
      );
      const combined = filterShellOutput(execResult.all, taskDir(taskId));
      return {
        exitCode: execResult.exitCode ?? 1,
        stderr: "",
        stdout: combined,
      };
    }

    const evalCode = firstString(values.e, values.eval);
    const inputType = firstString(values["input-type"]);
    const maxOldSpaceSize = firstString(values["max-old-space-size"]);
    const requires = stringArray(values.require);
    const imports = stringArray(values.import);

    const nodeFlags: string[] = [];
    if (inputType) {
      nodeFlags.push("--input-type", inputType);
    }
    if (maxOldSpaceSize) {
      nodeFlags.push(`--max-old-space-size=${maxOldSpaceSize}`);
    }
    for (const r of requires) {
      nodeFlags.push("--require", r);
    }
    for (const i of imports) {
      nodeFlags.push("--import", i);
    }

    if (evalCode !== undefined) {
      const execResult = await execNode(
        taskId,
        [...nodeFlags, "-e", evalCode],
        ctx.signal,
        taskCwd,
        env,
        latin1FromBytes(ctx.stdin) || undefined,
      );
      const combined = filterShellOutput(execResult.all, taskDir(taskId));
      return {
        exitCode: execResult.exitCode ?? 1,
        stderr: "",
        stdout: combined,
      };
    }

    if (positionals.length === 0) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} requires a file path argument or -e <code>.`,
        stdout: "",
      };
    }

    const fileAndArgs = extractFileAndScriptArgs(
      positionals,
      args,
      taskId,
      taskCwd,
      (p) => ctx.fs.resolvePath(ctx.cwd, p),
    );

    if (fileAndArgs === undefined) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} requires a file path argument.`,
        stdout: "",
      };
    }

    const { filePath, scriptArgs } = fileAndArgs;
    const execResult = await execNode(
      taskId,
      [...nodeFlags, filePath, ...scriptArgs],
      ctx.signal,
      taskCwd,
      env,
      latin1FromBytes(ctx.stdin) || undefined,
    );
    const combined = filterShellOutput(execResult.all, taskDir(taskId));

    return {
      exitCode: execResult.exitCode ?? 1,
      stderr: "",
      stdout: combined,
    };
  });
}
