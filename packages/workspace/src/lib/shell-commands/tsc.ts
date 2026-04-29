import { defineCommand } from "just-bash";

import type { AppConfig } from "../app-config/types";

import { runPnpmCommand } from "../run-pnpm";
import { resolveCommandContext } from "./utils";

export const TSC_COMMAND = {
  description:
    "TypeScript compiler for type-checking. Do not pass individual file paths -- this bypasses tsconfig.json and skips the project's compiler settings.",
  name: "tsc",
} as const;

export function createTscCommand(appConfig: AppConfig) {
  return defineCommand(TSC_COMMAND.name, async (args, ctx) => {
    const { appCwd, env } = resolveCommandContext(appConfig, ctx);

    const result = await runPnpmCommand({
      appConfig,
      args: ["--package=typescript", "dlx", "tsc", ...args],
      cwd: appCwd,
      env,
      pnpmLogLevel: "error", // Suppress Progress-style noise for dlx
      signal: ctx.signal,
      stdin: ctx.stdin || undefined,
    });

    return {
      exitCode: result.exitCode,
      stderr: "",
      stdout: result.combined,
    };
  });
}
