import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { FFPROBE_PATH } from "../ffmpeg";
import { filterShellOutput } from "../filter-shell-output";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import {
  resolveCommandContext,
  resolvePathArgs,
  subprocessStdin,
  unreachablePathArgError,
} from "./utils";

export const FFPROBE_COMMAND = {
  description: "Probe and inspect audio and video files using FFprobe.",
  name: "ffprobe",
} as const;

export function createFfprobeCommand(taskId: TaskId) {
  return defineCommand(FFPROBE_COMMAND.name, async (args, ctx) => {
    const unreachable = unreachablePathArgError(
      FFPROBE_COMMAND.name,
      args,
      ctx.cwd,
    );
    if (unreachable !== undefined) {
      return { exitCode: 1, stderr: unreachable, stdout: "" };
    }

    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const stdin = subprocessStdin(ctx.stdin);

    const result = await execShim(
      FFPROBE_PATH,
      // Same build-configuration block ffmpeg prints; `-version` still shows it.
      ["-hide_banner", ...resolvePathArgs(args, taskId, ctx)],
      {
        cancelSignal: ctx.signal,
        cwd: taskCwd,
        env: {
          ...getWorkspaceConfig().nodeExecEnv,
          ...env,
        },
        // Forwarded so a `pipe:0`/`-` input reads the pipe. Without a pipe,
        // an ignored stdin is what makes those inputs fail fast rather than
        // block on a stream that will never arrive.
        ...(stdin ? { input: stdin } : { stdin: "ignore" }),
      },
    );

    const streams = mapStreams(
      shimOutput(result, FFPROBE_COMMAND.name),
      (text) => filterShellOutput(text, taskDir(taskId)),
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...streams,
    };
  });
}
