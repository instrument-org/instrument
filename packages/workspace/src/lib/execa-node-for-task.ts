import { execa, type Options } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { ffmpegSubprocessEnv } from "./ffmpeg";
import { gitSubprocessEnv } from "./git";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig } from "./workspace-config";

export function execaNodeForTask<
  OptionsType extends Omit<Options, "cwd"> = Omit<Options, "cwd">,
>(
  taskId: TaskId,
  file: string | URL,
  arguments_?: readonly string[],
  options?: OptionsType,
  cwd?: AbsolutePath,
) {
  const baseEnv = {
    ...options?.env,
    ...ffmpegSubprocessEnv(options?.env?.PATH),
  };
  return execa(file, arguments_, {
    ...options,
    cwd: cwd ?? taskDir(taskId),
    env: {
      ...baseEnv,
      // Covers what resolveCommandContext cannot: the user's own app processes
      // (spawn-runtime) and anything else spawned for a task. A build script
      // that shells out to `git` gets the same isolation the agent does. Takes
      // the env ffmpeg just built so both binary dirs survive on PATH.
      ...gitSubprocessEnv(baseEnv),
      ...getWorkspaceConfig().nodeExecEnv,
    },
    node: true,
    nodeOptions: [],
    stdin: options?.input === undefined ? (options?.stdin ?? "ignore") : "pipe",
    // Ensures callers can use stderr and stdout without null check
  } as unknown as OptionsType & {
    cwd: string;
    env: Record<string, string>;
    node: true;
  });
}
