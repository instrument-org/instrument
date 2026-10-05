import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { filterShellOutput } from "./filter-shell-output";
import { taskDir } from "./task-dir-utils";
import { getUvBinPath, uvSubprocessEnv } from "./uv";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

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
    // Run for the task outside any shell, so with no folder of the user's
    // mounted: its own folder and the skills are all the output can name.
    combined: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
      buildWorkspaceFsLayout({ taskHostRoot: taskDir(taskId) }),
    ),
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
  };
}
