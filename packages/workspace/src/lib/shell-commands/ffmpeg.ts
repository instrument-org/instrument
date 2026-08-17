import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { FFMPEG_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, shimOutput } from "./exec-shim";
import {
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
} from "./utils";

export const FFMPEG_COMMAND = {
  description: "Process audio and video files using FFmpeg.",
  name: "ffmpeg",
} as const;

export function createFfmpegCommand(taskId: TaskId) {
  return defineCommand(FFMPEG_COMMAND.name, async (args, ctx) => {
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const stdin = subprocessStdin(ctx.stdin);

    const result = await execShim(
      FFMPEG_PATH,
      [
        // ffmpeg reads stdin for interactive keystrokes whenever it is not
        // itself an input, so piped bytes it does not consume would be taken as
        // commands -- a `q` anywhere in the stream aborts the encode midway.
        // This disables only that interaction; a `pipe:0`/`-` input still reads
        // the pipe.
        "-nostdin",
        ...resolvePathArgs(args, taskId, ctx),
      ],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
        },
        ...(stdin ? { input: stdin } : { stdin: "ignore" }),
      },
    );

    const combined = filterShellOutput(
      shimOutput(result, FFMPEG_COMMAND.name),
      taskDir(taskId),
    );
    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: combined,
    };
  });
}
