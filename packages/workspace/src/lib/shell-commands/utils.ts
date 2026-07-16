import { type ByteString, latin1FromBytes } from "just-bash";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";

import { ATTACHED_FOLDERS_MOUNT_ROOT } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { normalizePath } from "../normalize-path";
import { taskDir } from "../task-dir-utils";
import { uvSubprocessEnv } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import {
  resolveNativeHostPath,
  TASK_MOUNT_POINT,
} from "../workspace-fs-layout";

/**
 * Bridge sandbox-virtual paths inside inline script source (`-e`/`-c` code,
 * heredoc programs), which real interpreters otherwise resolve against the
 * host filesystem where `/task` and `/mnt` do not exist. Quoted `/task/...`
 * string literals become paths relative to taskCwd (the subprocess cwd) --
 * relative so the host dir never appears in the code and so Windows
 * backslashes never corrupt string escapes. The quote prefix is what
 * distinguishes a string literal from lookalikes such as JS regex literals
 * (`split(/task/)`), which must not be rewritten. Quoted `/mnt/...` literals
 * have no host path a subprocess may receive (read-only mounts), so they fail
 * fast with the copy-first guidance instead of dereferencing the host root.
 */
export function bridgeInlineCodePaths(
  code: string,
  taskId: TaskId,
  taskCwd: string,
): { code: string } | { error: string } {
  if (quotedMountPattern(ATTACHED_FOLDERS_MOUNT_ROOT).test(code)) {
    return {
      error:
        `Inline script code references a ${ATTACHED_FOLDERS_MOUNT_ROOT}/... path. ` +
        `Attached-folder mounts are only visible to the sandbox shell and file tools, ` +
        `never to real interpreter processes. Copy the file into the task first ` +
        `(cp '${ATTACHED_FOLDERS_MOUNT_ROOT}/<folder>/<file>' attachments/) and ` +
        `reference the copy with a task-relative path (attachments/<file>).`,
    };
  }

  const relativeTaskRoot =
    path.relative(taskCwd, taskDir(taskId)).replaceAll("\\", "/") || ".";
  return {
    code: code.replaceAll(
      quotedMountPattern(TASK_MOUNT_POINT),
      (_match, quote: string) => `${quote}${relativeTaskRoot}`,
    ),
  };
}

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
 * just-bash stdin bytes as a Buffer for a real subprocess, or undefined when
 * empty. execa UTF-8 encodes a string `input`, which would re-encode the
 * latin1-packed byte string and mojibake every non-ASCII byte (heredoc text,
 * piped binary data); a Buffer forwards the original bytes unchanged.
 */
export function subprocessStdin(stdin: ByteString): Buffer | undefined {
  const packed = latin1FromBytes(stdin);
  return packed ? Buffer.from(packed, "latin1") : undefined;
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
 * Matches a mount point immediately after an opening quote, continuing into a
 * subpath or closed by the same quote: `"/task/x"`, `'/task'`, `` `/mnt/Docs/a` ``.
 * Mount points contain no regex metacharacters beyond `/`.
 */
function quotedMountPattern(mountPoint: string): RegExp {
  return new RegExp(`(['"\`])${mountPoint}(?=/|\\1)`, "g");
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
