import { defineCommand, latin1FromBytes } from "just-bash";

import { MOUNT } from "../../mount-points";
import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, shimOutput } from "./exec-shim";
import { TS_COMMAND } from "./ts";
import {
  bridgeFlagValuePath,
  bridgeInlineCodePaths,
  extractFileAndScriptArgs,
  firstString,
  parseScriptRunnerArgs,
  resolveCommandContext,
  scanScriptFileForVirtualPaths,
  stringArray,
  subprocessStdin,
} from "./utils";

// Unrecognized flags are forwarded to node as-is; these are refused instead,
// because they park the process on a debugger or a file watcher that nothing
// in the sandbox can reach, so the command only ends when the agent's timeout
// kills it.
const BLOCKED_FLAGS = new Set(["--interactive", "-i"]);
const BLOCKED_FLAG_PREFIXES = ["--inspect", "--debug", "--watch"];

function execNode(
  taskId: TaskId,
  args: string[],
  signal?: AbortSignal,
  cwd?: AbsolutePath,
  env?: Record<string, string>,
  stdin?: Buffer,
) {
  return execShim(process.execPath, args, {
    cancelSignal: signal,
    cwd: cwd ?? taskDir(taskId),
    env: {
      ...getWorkspaceConfig().nodeExecEnv,
      ...env,
      // After ...env so the ffmpeg dirs win over ctx.env's host PATH.
      ...ffmpegSubprocessEnv(env?.PATH),
    },
    ...(stdin ? { input: stdin } : { stdin: "ignore" }),
  });
}

function isBlockedFlag(flag: string): boolean {
  const name = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
  return (
    BLOCKED_FLAGS.has(name) ||
    BLOCKED_FLAG_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

const KNOWN_OPTIONS = {
  c: { type: "boolean" },
  check: { type: "boolean" },
  e: { type: "string" },
  eval: { type: "string" },
  import: { multiple: true, type: "string" },
  "input-type": { type: "string" },
  "max-old-space-size": { type: "string" },
  p: { type: "string" },
  print: { type: "string" },
  require: { multiple: true, type: "string" },
  v: { type: "boolean" },
  version: { type: "boolean" },
} as const;

export const NODE_COMMAND = {
  description: `Run a JavaScript file with Node.js. In -e code: relative paths resolve from cwd, quoted "${MOUNT.task}/..." strings are bridged; ${MOUNT.attachedFolders} paths are not available.`,
  name: "node",
} as const;

export function createNodeCommand(taskId: TaskId) {
  return defineCommand(NODE_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const stdinProgram = latin1FromBytes(ctx.stdin);

    if (args.length === 0 && !stdinProgram) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} command requires a file argument or -e <code>. Prefer \`${TS_COMMAND.name}\` for TypeScript files.`,
        stdout: "",
      };
    }

    const { positionals, unknownFlags, values } = parseScriptRunnerArgs(
      NODE_COMMAND.name,
      args,
      KNOWN_OPTIONS,
      { captureUnknown: false },
    );

    const blockedFlag = unknownFlags.find(isBlockedFlag);
    if (blockedFlag !== undefined) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name}: ${blockedFlag} is not available in this environment. Interactive, debugger, and watch flags leave the command running with nothing able to attach to it.`,
        stdout: "",
      };
    }

    const isVersion = values.v === true || values.version === true;

    if (isVersion) {
      const execResult = await execNode(
        taskId,
        ["--version"],
        ctx.signal,
        taskCwd,
        env,
      );
      const combined = filterShellOutput(shimOutput(execResult, NODE_COMMAND.name), taskDir(taskId));
      return {
        exitCode: execResult.exitCode ?? 1,
        stderr: "",
        stdout: combined,
      };
    }

    // `-p`/`--print` is `-e` plus printing the result, and may also appear as a
    // bare flag alongside `-e` (`node -e '1+1' -p`), where parseArgs yields
    // `true` rather than the code.
    const wantsPrint = values.p !== undefined || values.print !== undefined;
    const evalCode = firstString(values.p, values.print, values.e, values.eval);
    const inputType = firstString(values["input-type"]);
    const maxOldSpaceSize = firstString(values["max-old-space-size"]);
    const requires = stringArray(values.require);
    const imports = stringArray(values.import);

    // Flags node understands but this shim does not interpret are forwarded
    // verbatim, so an unlisted one degrades to node's own error rather than
    // silently changing what the script does (a dropped `--env-file` left the
    // script running against the wrong environment, exit code 0).
    const nodeFlags = unknownFlags.map((flag) =>
      bridgeFlagValuePath(flag, taskId, taskCwd, (p) =>
        ctx.fs.resolvePath(ctx.cwd, p),
      ),
    );
    if (values.check === true || values.c === true) {
      nodeFlags.push("--check");
    }
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
      const bridged = bridgeInlineCodePaths(evalCode, taskId, taskCwd);
      if ("error" in bridged) {
        return { exitCode: 1, stderr: bridged.error, stdout: "" };
      }
      const execResult = await execNode(
        taskId,
        [...nodeFlags, wantsPrint ? "-p" : "-e", bridged.code],
        ctx.signal,
        taskCwd,
        env,
        subprocessStdin(ctx.stdin),
      );
      const combined = filterShellOutput(shimOutput(execResult, NODE_COMMAND.name), taskDir(taskId));
      return {
        exitCode: execResult.exitCode ?? 1,
        stderr: "",
        stdout: combined,
      };
    }

    if (positionals.length === 0) {
      // With no file, node reads the program itself from stdin
      // (`node --check < script.js`, heredocs), so bridge sandbox-virtual
      // paths in it the same way `-e` code is bridged.
      if (stdinProgram) {
        const bridged = bridgeInlineCodePaths(stdinProgram, taskId, taskCwd);
        if ("error" in bridged) {
          return { exitCode: 1, stderr: bridged.error, stdout: "" };
        }
        const execResult = await execNode(
          taskId,
          nodeFlags,
          ctx.signal,
          taskCwd,
          env,
          Buffer.from(bridged.code, "latin1"),
        );
        return {
          exitCode: execResult.exitCode ?? 1,
          stderr: "",
          stdout: filterShellOutput(shimOutput(execResult, NODE_COMMAND.name), taskDir(taskId)),
        };
      }

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

    const scanError = await scanScriptFileForVirtualPaths(taskCwd, filePath);
    if (scanError !== undefined) {
      return { exitCode: 1, stderr: scanError, stdout: "" };
    }

    const execResult = await execNode(
      taskId,
      [...nodeFlags, filePath, ...scriptArgs],
      ctx.signal,
      taskCwd,
      env,
      subprocessStdin(ctx.stdin),
    );
    const combined = filterShellOutput(shimOutput(execResult, NODE_COMMAND.name), taskDir(taskId));

    return {
      exitCode: execResult.exitCode ?? 1,
      stderr: "",
      stdout: combined,
    };
  });
}
