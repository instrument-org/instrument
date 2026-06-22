import { execa, type Options } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { ffmpegSubprocessEnv } from "./ffmpeg";
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
  return execa(file, arguments_, {
    ...options,
    cwd: cwd ?? taskDir(taskId),
    env: {
      ...options?.env,
      ...ffmpegSubprocessEnv(),
      ...getWorkspaceConfig().nodeExecEnv,
    },
    node: true,
    stdin: options?.input === undefined ? (options?.stdin ?? "ignore") : "pipe",
    // Ensures callers can use stderr and stdout without null check
  } as unknown as OptionsType & {
    cwd: string;
    env: Record<string, string>;
    node: true;
  });
}
