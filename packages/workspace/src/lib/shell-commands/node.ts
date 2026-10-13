import { defineCommand, latin1FromBytes } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { type AppToolInvoker } from "../app-tool-hook";
import {
  answerToolCall,
  isToolCallMessage,
  nodeToolsPreloadUrl,
} from "../node-tools-preload";
import { nodeToolsEnv } from "../tool-isolation";
import { getWorkspaceConfig } from "../workspace-config";
import { APP_COMMAND } from "./app-command";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  firstString,
  hostPathArgs,
  parseScriptRunnerArgs,
  resolveCommandContext,
  stringArray,
  subprocessStdin,
} from "./utils";
import { workDir } from "../work-dir";

// Unrecognized flags are forwarded to node as-is; these are refused instead,
// because they park the process on a debugger or a file watcher that nothing
// in the sandbox can reach, so the command only ends when the agent's timeout
// kills it.
const BLOCKED_FLAGS = new Set(["--interactive", "-i"]);
const BLOCKED_FLAG_PREFIXES = ["--inspect", "--debug", "--watch"];

async function execNode(
  chatId: ChatId,
  args: string[],
  signal?: AbortSignal,
  cwd?: AbsolutePath,
  env?: Record<string, string>,
  stdin?: Buffer,
  invokeTool?: AppToolInvoker,
) {
  const preload = invokeTool ? ["--import", await nodeToolsPreloadUrl()] : [];
  return execShim(process.execPath, [...preload, ...args], {
    cancelSignal: signal,
    ...(invokeTool && {
      onMessage: (message, reply) => {
        if (!isToolCallMessage(message)) {
          return;
        }
        void answerToolCall(message, () =>
          invokeTool(message.path, message.argsJson, signal),
        ).then(reply);
      },
    }),
    cwd: cwd ?? workDir(chatId),
    env: {
      ...getWorkspaceConfig().nodeExecEnv,
      ...env,
      // A script that installs or builds a native addon uses the app's own
      // npm config, store and node-gyp headers, never the person's.
      ...nodeToolsEnv(),
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
  description: `Run a TypeScript or JavaScript file as a real process, with the task's installed packages. Types are stripped, not checked. A loaded skill's dependencies resolve only from inside that skill's folder. In -e code: relative paths resolve from cwd. \`await tools.<slug>.<tool>({...})\` calls a connected app's tool as \`${APP_COMMAND.name} call\` does and returns the result as a value (\`tools["<slug>"]\` for a slug with a hyphen); only the script \`node\` runs has \`tools\`, not a process that script starts.`,
  name: "node",
} as const;

/**
 * `node` as a real process. With `invokeTool`, the script gets the `tools`
 * global (`node-tools-preload.ts`), and this command answers each call it
 * makes over the subprocess's IPC channel.
 */
export function createNodeCommand(chatId: ChatId, invokeTool?: AppToolInvoker) {
  return defineCommand(NODE_COMMAND.name, async (args, ctx) => {
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const stdinProgram = latin1FromBytes(ctx.stdin);

    if (args.length === 0 && !stdinProgram) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} command requires a file argument or -e <code>.`,
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
        chatId,
        ["--version"],
        ctx.signal,
        hostCwd,
        env,
      );
      const streams = mapStreams(
        shimOutput(execResult, NODE_COMMAND.name),
        (text) => filterShellOutput(text),
      );
      return {
        exitCode: execResult.exitCode ?? 1,
        ...streams,
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
    const nodeFlags = hostPathArgs(unknownFlags);
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
      const execResult = await execNode(
        chatId,
        [
          ...nodeFlags,
          wantsPrint ? "-p" : "-e",
          evalCode,
          // The script's own arguments, in process.argv after the executable.
          ...hostPathArgs(positionals),
        ],
        ctx.signal,
        hostCwd,
        env,
        subprocessStdin(ctx.stdin),
        invokeTool,
      );
      const streams = mapStreams(
        shimOutput(execResult, NODE_COMMAND.name),
        (text) => filterShellOutput(text),
      );
      return {
        exitCode: execResult.exitCode ?? 1,
        ...streams,
      };
    }

    if (positionals.length === 0) {
      // With no file, node reads the program itself from stdin
      // (`node --check < script.js`, heredocs).
      if (stdinProgram) {
        const execResult = await execNode(
          chatId,
          nodeFlags,
          ctx.signal,
          hostCwd,
          env,
          Buffer.from(stdinProgram, "latin1"),
          invokeTool,
        );
        return {
          exitCode: execResult.exitCode ?? 1,
          ...mapStreams(shimOutput(execResult, NODE_COMMAND.name), (text) =>
            filterShellOutput(text),
          ),
        };
      }

      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} requires a file path argument or -e <code>.`,
        stdout: "",
      };
    }

    const [filePath, ...scriptArgs] = hostPathArgs(
      args.slice(args.indexOf(positionals[0] ?? "")),
    );
    if (filePath === undefined) {
      return {
        exitCode: 1,
        stderr: `${NODE_COMMAND.name} requires a file path argument.`,
        stdout: "",
      };
    }

    const execResult = await execNode(
      chatId,
      [...nodeFlags, filePath, ...scriptArgs],
      ctx.signal,
      hostCwd,
      env,
      subprocessStdin(ctx.stdin),
      invokeTool,
    );
    const streams = mapStreams(
      shimOutput(execResult, NODE_COMMAND.name),
      (text) => filterShellOutput(text),
    );

    return {
      exitCode: execResult.exitCode ?? 1,
      ...streams,
    };
  });
}
