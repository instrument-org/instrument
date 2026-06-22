import { execa } from "execa";
import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../app-dir-utils";
import { FFPROBE_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { getWorkspaceConfig } from "../workspace-config";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const FFPROBE_COMMAND = {
  description: "Probe and inspect audio and video files using FFprobe.",
  name: "ffprobe",
} as const;

export function createFfprobeCommand(taskId: TaskId) {
  return defineCommand(FFPROBE_COMMAND.name, async (args, ctx) => {
    const { appCwd, env } = resolveCommandContext(taskId, ctx);

    const result = await execa(
      FFPROBE_PATH,
      resolvePathArgs(args, taskId, ctx),
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

    const combined = filterShellOutput(result.all, taskDir(taskId));
    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: combined,
    };
  });
}
