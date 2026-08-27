import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { commandLineToolsEnv } from "./command-line-tools-env";
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
  /** Forwarded to pnpm as `pnpm_config_loglevel`. Only `"error"` is supported (suppresses info noise; not `silent`). */
  pnpmLogLevel?: "error";
  signal?: AbortSignal;
  /** Raw bytes; a string would be UTF-8 re-encoded by execa (see subprocessStdin). */
  stdin?: Buffer;
  taskId: TaskId;
}) {
  const execResult = await execaNodeForTask(
    taskId,
    getWorkspaceConfig().pnpmBinPath,
    args,
    {
      cancelSignal: signal,
      env: {
        ...env,
        // Keep a native (node-gyp) build from launching the macOS Command Line
        // Tools installer dialog and hanging the tool call.
        ...commandLineToolsEnv(),
        // just-bash sets HOME=/ when a cwd is given. pnpm uses os.homedir() to
        // locate its store and cache, so HOME=/ causes it to write to /Library/...
        // on the host filesystem and record that wrong store path in .modules.yaml.
        // Subsequent pnpm runs then see a store mismatch and try to purge
        // node_modules, which fails without a TTY (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
        // Must come after ...env so ctx.env (which contains HOME=/) cannot override it.
        ...(process.env.HOME && { HOME: process.env.HOME }),
        pnpm_config_reporter: "append-only",
        ...(pnpmLogLevel === "error" ? { pnpm_config_loglevel: "error" } : {}),
      },
      // Don't reject so we can filter the output
      reject: false,
      ...(stdin && { input: stdin }),
    },
    cwd,
  );
  const clean = (text: unknown) =>
    typeof text === "string" ? filterShellOutput(text, taskDir(taskId)) : "";
  return {
    command: `${PNPM_NAME} ${args.join(" ")}`,
    exitCode: execResult.exitCode ?? 1,
    stderr: clean(execResult.stderr),
    stdout: clean(execResult.stdout),
  };
}
