import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { FFMPEG_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim } from "./exec-shim";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const FFMPEG_COMMAND = {
  description: "Process audio and video files using FFmpeg.",
  name: "ffmpeg",
} as const;

export function createFfmpegCommand(taskId: TaskId) {
  return defineCommand(FFMPEG_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const result = await execShim(
      FFMPEG_PATH,
      resolvePathArgs(args, taskId, ctx),
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
        },
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
