import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";

import { type TaskId } from "../../schemas/task-id";
import { normalizePath } from "../normalize-path";
import { taskDir } from "../task-dir-utils";
import { uvSubprocessEnv } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import { resolveNativeHostPath } from "../workspace-fs-layout";

/**
 * Extract the resolved file path and trailing script args from positionals + original args.
 * Paths are returned relative to taskCwd so the real host dir is not exposed.
 * All path-like script args (absolute or relative traversals) are resolved through
 * the virtual FS so they land correctly regardless of the agent's cwd.
 */
export function extractFileAndScriptArgs(
  positionals: string[],
  args: string[],
  taskId: TaskId,
  taskCwd: string,
  resolvePath: (path: string) => string,
): undefined | { filePath: string; scriptArgs: string[] } {
  const rawFilePath = positionals[0];
  if (rawFilePath === undefined) {
    return undefined;
  }

  const filePath = virtualToRealRelative(
    rawFilePath,
    taskId,
    taskCwd,
    resolvePath,
  );
  const filePathIndex = args.indexOf(rawFilePath);
  const rawScriptArgs = args.slice(filePathIndex + 1);
  const scriptArgs = rawScriptArgs.map((arg) =>
    looksLikePath(arg)
      ? virtualToRealRelative(arg, taskId, taskCwd, resolvePath)
      : arg,
  );

  return { filePath, scriptArgs };
}

/** Pick the first string value from a set of aliased parseArgs values. */
export function firstString(
  ...values: ((boolean | string)[] | boolean | string | undefined)[]
): string | undefined {
  return values.find((v): v is string => typeof v === "string");
}

/** Parse args and warn about unrecognized options via captureException. */
export function parseScriptRunnerArgs<
  T extends NonNullable<ParseArgsConfig["options"]>,
>(commandName: string, args: string[], options: T) {
  const result = parseArgs({
    allowPositionals: true,
    args,
    options,
    strict: false,
    tokens: true,
  });

  const foundIndex = result.tokens.findIndex((t) => t.kind === "positional");
  const firstPositionalIndex = foundIndex === -1 ? Infinity : foundIndex;
  const unknownOptions = result.tokens
    .filter(
      (t, i) =>
        i < firstPositionalIndex && t.kind === "option" && !(t.name in options),
    )
    .map((t) => `--${(t as { kind: "option"; name: string }).name}`);

  if (unknownOptions.length > 0) {
    getWorkspaceConfig().captureException(
      new Error(
        `[${commandName}] Unrecognized options ignored: ${unknownOptions.join(", ")}`,
      ),
    );
  }

  return result;
}

/** Resolve the effective cwd and env for a shell command. */
export function resolveCommandContext(
  taskId: TaskId,
  ctx: {
    cwd: string;
    env: Map<string, string>;
    fs: { resolvePath(cwd: string, path: string): string };
  },
) {
  return {
    // Overlay the uv/python env so the real-binary escape hatches (tsx, node,
    // ffmpeg, uv, python, pip) all resolve `uv`/`python` on PATH and share the
    // task venv. uvSubprocessEnv wins (PATH/VIRTUAL_ENV) over the bash env.
    env: {
      ...Object.fromEntries(ctx.env),
      ...uvSubprocessEnv({ taskId }),
    },
    taskCwd: resolveNativeHostPath(
      taskDir(taskId),
      ctx.fs.resolvePath(ctx.cwd, "."),
    ),
  };
}

/**
 * Resolves any argument that looks like a virtual absolute path (starts with `/`)
 * into a real filesystem path under dir. Non-path arguments are returned as-is.
 * This prevents sandbox-virtual absolute paths from leaking to the host system.
 */
export function resolvePathArgs(
  args: string[],
  taskId: TaskId,
  ctx: {
    cwd: string;
    fs: { resolvePath(cwd: string, path: string): string };
  },
): string[] {
  return args.map((arg) => {
    if (!arg.startsWith("/")) {
      return arg;
    }
    const virtualPath = ctx.fs.resolvePath(ctx.cwd, arg);
    return resolveNativeHostPath(taskDir(taskId), virtualPath);
  });
}

/** Extract a string array from a parseArgs multi-value option. */
export function stringArray(
  value: (boolean | string)[] | boolean | string | undefined,
): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Returns true for args that look like a file path and need sandbox resolution:
 * starts with `/` (virtual absolute) or starts with `.` or contains `/` (relative traversal).
 */
function looksLikePath(arg: string): boolean {
  return (
    arg.startsWith("/") ||
    arg.startsWith("\\") ||
    arg.startsWith(".") ||
    /^[a-z]:[\\/]/i.test(arg) ||
    arg.includes("/") ||
    arg.includes("\\")
  );
}

/**
 * Resolve a virtual path to a real path, then relativize from taskCwd so the
 * host dir is never exposed to the subprocess.
 */
function virtualToRealRelative(
  virtualPath: string,
  taskId: TaskId,
  taskCwd: string,
  resolvePath: (p: string) => string,
): string {
  const normalizedVirtualPath = normalizePath(virtualPath);
  const realAbs = resolveNativeHostPath(
    taskDir(taskId),
    resolvePath(normalizedVirtualPath),
  );
  return path.relative(taskCwd, realAbs);
}
