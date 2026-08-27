import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { runPnpmCommand } from "../run-pnpm";
import { resolveCommandContext, subprocessStdin } from "./utils";

export const TSC_COMMAND = {
  description:
    "TypeScript compiler for type-checking. Do not pass individual file paths -- this bypasses tsconfig.json and skips the local config.",
  name: "tsc",
} as const;

export function createTscCommand(taskId: TaskId) {
  return defineCommand(TSC_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const result = await runPnpmCommand({
      args: ["--package=typescript@5.9.3", "dlx", "tsc", ...args],
      cwd: taskCwd,
      env,
      pnpmLogLevel: "error", // Suppress Progress-style noise for dlx
      signal: ctx.signal,
      stdin: subprocessStdin(ctx.stdin),
      taskId,
    });

    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  });
}
