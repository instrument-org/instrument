import { type TaskId } from "../schemas/task-id";
import { invokeAppTool } from "./shell-commands/app";

/**
 * just-bash's `javascript.invokeTool`: a dotted tool path and the arguments as
 * JSON in, the result as JSON out. just-bash builds the `tools` proxy a
 * `js-exec` script calls through it. The signal is the script's own, where the
 * just-bash build passes one.
 */
export type AppToolInvoker = (
  path: string,
  argsJson: string,
  signal?: AbortSignal,
) => Promise<string>;

/**
 * The hook for a task's shell: `tools.<slug>.<tool>(args)` calls that app's
 * MCP tool through the same checks `app call` makes for this task.
 */
export function appToolHook(taskId: TaskId): AppToolInvoker {
  return (path, argsJson, signal) =>
    invokeAppTool({ taskId }, path, argsJson, signal);
}
