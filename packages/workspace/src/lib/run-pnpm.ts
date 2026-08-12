import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { commandLineToolsEnv } from "./command-line-tools-env";
import { execaNodeForTask } from "./execa-node-for-task";
import { filterShellOutput } from "./filter-shell-output";
import {
  collectAndForward,
  currentShellOutputSink,
} from "./shell-commands/output-sink";
import { watchSubprocessTree } from "./subprocess-tree";
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
  const sink = currentShellOutputSink();
  const subprocess = execaNodeForTask(
    taskId,
    getWorkspaceConfig().pnpmBinPath,
    args,
    {
      all: true,
      // A background run reads the merged stream itself so lines reach its sink
      // as pnpm writes them; execa buffering the same stream would split the
      // chunks between the two consumers.
      buffer: sink === undefined,
      cancelSignal: sink ? undefined : signal,
      detached: sink !== undefined && process.platform !== "win32",
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
  const finishTreeTermination = sink
    ? watchSubprocessTree({ pid: subprocess.pid, signal })
    : undefined;
  // Forwarded raw: the sink redacts every chunk it is handed, so redacting here
  // too would only duplicate the work. Whole lines still matter, because that
  // redaction is line-anchored and a chunk boundary mid-line would let a
  // `password=` line through split in two.
  const streamed = sink ? collectAndForward(subprocess.all, sink) : undefined;
  const execResult = await subprocess;
  await finishTreeTermination?.();
  const combined = filterShellOutput(
    streamed ? await streamed : execResult.all,
    taskDir(taskId),
  );
  return {
    combined,
    command: `${PNPM_NAME} ${args.join(" ")}`,
    exitCode: execResult.exitCode ?? 1,
  };
}
