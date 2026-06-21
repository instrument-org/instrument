import { execa } from "execa";
import { defineCommand } from "just-bash";

import type { AppConfig } from "../app-config/types";

import { FFMPEG_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { getWorkspaceConfig } from "../workspace-config";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const FFMPEG_COMMAND = {
  description: "Process audio and video files using FFmpeg.",
  name: "ffmpeg",
} as const;

export function createFfmpegCommand(appConfig: AppConfig) {
  return defineCommand(FFMPEG_COMMAND.name, async (args, ctx) => {
    const { appCwd, env } = resolveCommandContext(appConfig, ctx);

    const result = await execa(
      FFMPEG_PATH,
      resolvePathArgs(args, appConfig, ctx),
      {
        all: true,
        cancelSignal: ctx.signal,
        cwd: appCwd,
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
        },
        reject: false,
        stdin: "ignore",
      },
    );

    const combined = filterShellOutput(result.all, appConfig.appDir);
    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: combined,
    };
  });
}
