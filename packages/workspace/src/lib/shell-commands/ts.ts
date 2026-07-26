import { defineCommand } from "just-bash";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { type TaskId } from "../../schemas/task-id";
import { absolutePathJoin } from "../absolute-path-join";
import { runPnpmCommand } from "../run-pnpm";
import {
  bridgeInlineCodePaths,
  extractFileAndScriptArgs,
  firstString,
  parseScriptRunnerArgs,
  resolveCommandContext,
  scanScriptFileForVirtualPaths,
  subprocessStdin,
} from "./utils";

export const TS_COMMAND = {
  description:
    'Execute a TypeScript or JavaScript file. In -e code: relative paths resolve from cwd, quoted "/task/..." strings are bridged; /mnt paths are not available.',
  name: "tsx",
} as const;

const KNOWN_OPTIONS = {
  e: { type: "string" },
  eval: { type: "string" },
  v: { type: "boolean" },
  version: { type: "boolean" },
} as const;

export function createTsCommand(taskId: TaskId) {
  return defineCommand(TS_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    if (args.length === 0) {
      return {
        exitCode: 1,
        stderr: `${TS_COMMAND.name} command requires a file argument (e.g., ${TS_COMMAND.name} scripts/setup.ts). Running ${TS_COMMAND.name} without arguments spawns an interactive shell.`,
        stdout: "",
      };
    }

    const { positionals, values } = parseScriptRunnerArgs(
      "ts",
      args,
      KNOWN_OPTIONS,
    );

    if (values.v === true || values.version === true) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `node ${process.version}`,
      };
    }

    const evalCode = firstString(values.e, values.eval);

    let filePath: string;
    let scriptArgs: string[];
    let evalFileToCleanup: string | undefined;

    if (evalCode === undefined) {
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
          stderr: `${TS_COMMAND.name} requires exactly one file path as a positional argument (e.g., ${TS_COMMAND.name} scripts/setup.ts).`,
          stdout: "",
        };
      }

      ({ filePath, scriptArgs } = fileAndArgs);

      const scanError = await scanScriptFileForVirtualPaths(taskCwd, filePath);
      if (scanError !== undefined) {
        return { exitCode: 1, stderr: scanError, stdout: "" };
      }
    } else {
      const bridged = bridgeInlineCodePaths(evalCode, taskId, taskCwd);
      if ("error" in bridged) {
        return { exitCode: 1, stderr: bridged.error, stdout: "" };
      }
      // Write the eval file into the current working directory (not a fixed
      // app-root tmp dir) so jiti resolves modules and relative paths from
      // where the agent is. Matches real `tsx -e` and `tsx <file>`: after
      // `cd work/skills/<source>/<skill>`, `tsx -e 'import sharp'` finds the
      // skill's node_modules. A root tmp dir broke this regardless of cwd.
      const fileName = `.ts-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`;
      await mkdir(taskCwd, { recursive: true });
      await writeFile(
        absolutePathJoin(taskCwd, fileName),
        bridged.code,
        "utf8",
      );
      // Pass relative to taskCwd (the jiti cwd) so the host dir is not
      // exposed in jiti stack traces.
      filePath = fileName;
      scriptArgs = [];
      evalFileToCleanup = absolutePathJoin(taskCwd, fileName);
    }

    try {
      // Use pnpm dlx for faster execution via cached packages and avoid
      // installing all packages eagerly.
      const result = await runPnpmCommand({
        args: ["dlx", "jiti@2.6.1", filePath, ...scriptArgs],
        cwd: taskCwd,
        env,
        pnpmLogLevel: "error", // Suppress Progress-style noise for dlx
        signal: ctx.signal,
        stdin: subprocessStdin(ctx.stdin),
        taskId,
      });

      return {
        exitCode: result.exitCode,
        stderr: "",
        stdout: result.combined,
      };
    } finally {
      if (evalFileToCleanup !== undefined) {
        await rm(evalFileToCleanup, { force: true });
      }
    }
  });
}
