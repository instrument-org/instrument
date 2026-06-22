import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { execaNodeForTask } from "./execa-node-for-task";
import { filterShellOutput } from "./filter-shell-output";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig } from "./workspace-config";

export const PNPM_NAME = "pnpm";

export async function runPnpmCommand({
  args,
  cwd,
  env,
  pnpmLogLevel,
  signal,
  stdin,
  taskId,
}: {
  args: string[];
  cwd?: AbsolutePath;
  env?: Record<string, string>;
  /** Forwarded to pnpm as `npm_config_loglevel`. Only `"error"` is supported (suppresses info noise; not `silent`). */
  pnpmLogLevel?: "error";
  signal?: AbortSignal;
  stdin?: string;
  taskId: TaskId;
}) {
  const execResult = await execaNodeForTask(
    taskId,
    getWorkspaceConfig().pnpmBinPath,
    args,
    {
      all: true,
      cancelSignal: signal,
      env: {
        ...env,
        // just-bash sets HOME=/ when a cwd is given. pnpm uses os.homedir() to
        // locate its store and cache, so HOME=/ causes it to write to /Library/...
        // on the host filesystem and record that wrong store path in .modules.yaml.
        // Subsequent pnpm runs then see a store mismatch and try to purge
        // node_modules, which fails without a TTY (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
        // Must come after ...env so ctx.env (which contains HOME=/) cannot override it.
        ...(process.env.HOME && { HOME: process.env.HOME }),
        npm_config_reporter: "append-only",
        ...(pnpmLogLevel === "error" ? { npm_config_loglevel: "error" } : {}),
      },
      // Don't reject so we can filter the output
      reject: false,
      ...(stdin && { input: stdin }),
    },
    cwd,
  );
  const combined = filterShellOutput(execResult.all, taskDir(taskId));
  return {
    combined,
    command: `${PNPM_NAME} ${args.join(" ")}`,
    exitCode: execResult.exitCode ?? 1,
  };
}
