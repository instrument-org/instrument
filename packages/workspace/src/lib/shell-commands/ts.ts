import {
  defineCommand,
  latin1FromBytes,
} from "just-bash";
import {
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

import type { AppConfig } from "../app-config/types";

import {
  absolutePathJoin,
} from "../absolute-path-join";
import {
  runPnpmCommand,
} from "../run-pnpm";
import {
  extractFileAndScriptArgs,
  firstString,
  parseScriptRunnerArgs,
  resolveCommandContext,
} from "./utils";

export const TS_COMMAND = {
  description:
    "Execute a TypeScript or JavaScript file. In -e: relative paths resolve from cwd; avoid absolute paths like /tmp/file — they hit the real root, not the task root.",
  name: "tsx",
} as const;

const KNOWN_OPTIONS = {
  e: { type: "string" },
  eval: { type: "string" },
  v: { type: "boolean" },
  version: { type: "boolean" },
} as const;

export function createTsCommand(appConfig: AppConfig) {
  return defineCommand(TS_COMMAND.name, async (args, ctx) => {
    const { appCwd, env } = resolveCommandContext(appConfig, ctx);

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
        appConfig,
        appCwd,
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
    } else {
      // Write the eval file into the current working directory (not a fixed
      // app-root tmp dir) so jiti resolves modules and relative paths from
      // where the agent is. Matches real `tsx -e` and `tsx <file>`: after
      // `cd skills/<skill>`, `tsx -e 'import sharp'` finds the skill's
      // node_modules. A root tmp dir broke this regardless of cwd.
      const fileName = `.ts-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`;
      await mkdir(appCwd, { recursive: true });
      await writeFile(absolutePathJoin(appCwd, fileName), evalCode, "utf8");
      // Pass relative to appCwd (the jiti cwd) so the host appDir is not
      // exposed in jiti stack traces.
      filePath = fileName;
      scriptArgs = [];
      evalFileToCleanup = absolutePathJoin(appCwd, fileName);
    }

    try {
      // Use pnpm dlx for faster execution via cached packages and avoid
      // installing all packages eagerly.
      const result = await runPnpmCommand({
        appConfig,
        args: ["dlx", "jiti@2.6.1", filePath, ...scriptArgs],
        cwd: appCwd,
        env,
        pnpmLogLevel: "error", // Suppress Progress-style noise for dlx
        signal: ctx.signal,
        stdin: latin1FromBytes(ctx.stdin) || undefined,
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
