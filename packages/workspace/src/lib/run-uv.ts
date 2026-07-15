import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { filterShellOutput } from "./filter-shell-output";
import { taskDir } from "./task-dir-utils";
import { getUvBinPath, uvSubprocessEnv } from "./uv";

export async function runUvCommand({
  args,
  cwd,
  signal,
  stdin,
  taskId,
}: {
  args: string[];
  cwd?: AbsolutePath;
  signal?: AbortSignal;
  stdin?: string;
  taskId: TaskId;
}) {
  const result = await execa(getUvBinPath(), args, {
    all: true,
    cancelSignal: signal,
    cwd,
    env: uvSubprocessEnv({ taskId }),
    reject: false,
    ...(stdin === undefined ? { stdin: "ignore" } : { input: stdin }),
  });

  return {
    combined: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
      taskDir(taskId),
    ),
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
  };
}
