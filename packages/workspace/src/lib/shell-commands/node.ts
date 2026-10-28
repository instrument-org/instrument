import { defineCommand, latin1FromBytes } from "just-bash";

import { type AbsolutePath } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { ffmpegSubprocessEnv } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { type ChannelAnswer, openScriptChannel } from "../capabilities/channel";
import { scriptSurfaceOpen } from "../capabilities/script-surface";
import { ensureInstrumentStub } from "../capabilities/stub";
import { nodePreloadUrl } from "../node-preload";
import { nodeToolsEnv } from "../tool-isolation";
import { getWorkspaceConfig } from "../workspace-config";
import { binaryStdout, mapStreams, shimOutput } from "./exec-shim";
import { runNative } from "./pipe-stage";
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

export async function execNode(
  chatId: ChatId,
  args: string[],
  ctx: NodeContext,
  cwd?: AbsolutePath,
  env?: Record<string, string>,
  stdin?: Buffer,
  answerScript?: ChannelAnswer,
) {
  const signal = ctx.signal;
  // Every script gets the preload, which reads past a package.json the
  // sandbox refuses; `instrument` only works with a channel to answer it.
  const preload =
    args[0] === "--version" ? [] : ["--import", await nodePreloadUrl()];
  const answer = scriptSurfaceOpen() ? answerScript : undefined;
  if (answer) {
    await ensureInstrumentStub();
  }
  const scriptChannel =
    answer &&
    (await openScriptChannel((request, stageSignal) =>
      answer(request, stageSignal ?? signal),
    ));
  try {
    return await runNative(
      ctx,
      process.execPath,
      [...preload, ...args],
      {
        cancelSignal: signal,
        ...(scriptChannel && { scriptChannel }),
        cwd: cwd ?? workDir(chatId),
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
          // A script that installs or builds a native addon uses the app's own
          // npm config, store and node-gyp headers, never the person's.
          ...nodeToolsEnv(),
          // After ...env so the ffmpeg dirs win over ctx.env's host PATH.
          ...ffmpegSubprocessEnv(env?.PATH),
          ...scriptChannel?.env,
        },
        ...(stdin ? { input: stdin } : { stdin: "ignore" as const }),
      },
      (result) => ({
        exitCode: result.exitCode ?? 1,
        ...mapStreams(shimOutput(result, NODE_COMMAND.name), (text) =>
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

type NodeContext = Parameters<typeof runNative>[0];

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
  description: `Run a TypeScript or JavaScript file as a real process, with the task's installed packages. Types are stripped, not checked. A loaded skill's dependencies resolve only from inside that skill's folder. In -e code: relative paths resolve from cwd.`,
  name: "node",
  /** What the description adds where a script reaches \`instrument\`. */
  scripting: `The script has an \`instrument\` global for connected apps, returning values: \`await instrument.apps["<slug>"].<tool>({...})\` calls an MCP app's tool, \`await instrument.apps["<slug>"].get("<path>", { params })\` (\`.post(path, { body })\`, ...) an API app and resolves to the parsed body, throwing \`instrument.ReadGuideFirst\` with the guide before an app's first request; only the script \`node\` runs has it, not a process that script starts.`,
} as const;

/**
 * `node` as a real process. With `answerScript`, the script gets the
 * `instrument` global (`capabilities/node-runtime.ts`), and this command
 * answers each call it makes over a loopback channel opened for that one
 * process.
 */
export function createNodeCommand(
  chatId: ChatId,
  answerScript?: ChannelAnswer,
) {
  const command = defineCommand(NODE_COMMAND.name, async (args, ctx) => {
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const stdinProgram = latin1FromBytes(ctx.stdin);

    if (args.length === 0 && !stdinProgram && ctx.stdinHandoff === undefined) {
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
      return execNode(chatId, ["--version"], ctx, hostCwd, env);
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
      return execNode(
        chatId,
        [
          ...nodeFlags,
          wantsPrint ? "-p" : "-e",
          evalCode,
          // The script's own arguments, in process.argv after the executable.
          ...hostPathArgs(positionals),
        ],
        ctx,
        hostCwd,
        env,
        subprocessStdin(ctx.stdin),
        answerScript,
      );
    }

    if (positionals.length === 0) {
      // With no file, node reads the program itself from stdin
      // (`node --check < script.js`, heredocs).
      if (stdinProgram || ctx.stdinHandoff !== undefined) {
        return execNode(
          chatId,
          nodeFlags,
          ctx,
          hostCwd,
          env,
          stdinProgram ? Buffer.from(stdinProgram, "latin1") : undefined,
          answerScript,
        );
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

    return execNode(
      chatId,
      [...nodeFlags, filePath, ...scriptArgs],
      ctx,
      hostCwd,
      env,
      subprocessStdin(ctx.stdin),
      answerScript,
    );
  });
  return { ...command, acceptsPipeHandoff: true };
}
