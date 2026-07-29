import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { FFPROBE_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim } from "./exec-shim";
import { resolveCommandContext, resolvePathArgs } from "./utils";

export const FFPROBE_COMMAND = {
  description: "Probe and inspect audio and video files using FFprobe.",
  name: "ffprobe",
} as const;

export function createFfprobeCommand(taskId: TaskId) {
  return defineCommand(FFPROBE_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);

    const result = await execShim(
      FFPROBE_PATH,
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
