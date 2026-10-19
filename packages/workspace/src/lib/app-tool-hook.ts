import { invokeAppTool } from "./shell-commands/app";

/**
 * What answers a `node` script's `tools.<slug>.<tool>(args)`: a dotted tool
 * path and the arguments as JSON in, the result as JSON out. The signal is the
 * `node` command's own, so a stopped command stops its calls.
 */
export type AppToolInvoker = (
  path: string,
  argsJson: string,
  signal?: AbortSignal,
) => Promise<string>;

/**
 * The hook for the agent's shell: `tools.<slug>.<tool>(args)` calls that
 * app's MCP tool through the same checks `instrument app call` makes.
 */
export const appToolHook: AppToolInvoker = (path, argsJson, signal) =>
  invokeAppTool(path, argsJson, signal);
