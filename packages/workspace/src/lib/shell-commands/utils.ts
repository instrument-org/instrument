import { type ByteString, latin1FromBytes } from "just-bash";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { gitSubprocessEnv } from "../git";
import { normalizePath } from "../normalize-path";
import { getTaskTmpDir, taskDir } from "../task-dir-utils";
import { uvSubprocessEnv } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import {
  privateMountPoint,
  resolveNativeHostPath,
} from "../workspace-fs-layout";

/** Copy-first guidance for a `/mnt/...` reference; subject names the source. */
export function attachedMountLiteralError(subject: string): string {
  return (
    `${subject} references a ${MOUNT.attachedFolders}/... path. ` +
    `Attached-folder mounts are only visible to the sandbox shell and file tools, ` +
    `never to real interpreter processes. Copy the file into the task first ` +
    `(cp '${MOUNT.attachedFolders}/<folder>/<file>' attachments/) and ` +
    `reference the copy with a task-relative path (attachments/<file>).`
  );
}

/**
 * The first attached-folder path a shim was pointed at, whether through an
 * argument or through the working directory it inherited, or undefined.
 *
 * `resolveNativeHostPath` quarantines a `/mnt/...` path to a non-existent
 * location inside the task, which is the containment working as designed --
 * but the resulting failure describes the quarantined path, not the mount the
 * agent actually named, so the report reads like a path bug in the sandbox
 * rather than the boundary it is. Callers use this to answer with the mount
 * the agent asked for before spawning anything.
 */
export function attachedMountReference(
  args: string[],
  virtualCwd: string,
): string | undefined {
  const underMount = (value: string) =>
    value === MOUNT.attachedFolders ||
    value.startsWith(`${MOUNT.attachedFolders}/`);

  if (underMount(normalizePath(virtualCwd))) {
    return normalizePath(virtualCwd);
  }
  return args
    .map((arg) => normalizePath(arg.slice(arg.indexOf("=") + 1)))
    .find((value) => underMount(value));
}

/**
 * Rewrite the value of a `--flag=<path>` token that points at a
 * sandbox-virtual absolute path (`--env-file=/task/work/.env`) so the real
 * subprocess resolves it, relative to taskCwd so the host dir stays hidden.
 * Flags without an inline path value are returned unchanged.
 */
export function bridgeFlagValuePath(
  flag: string,
  taskId: TaskId,
  taskCwd: string,
  resolvePath: (p: string) => string,
): string {
  const eqIndex = flag.indexOf("=");
  const value = eqIndex > 0 ? flag.slice(eqIndex + 1) : "";
  if (!value.startsWith("/")) {
    return flag;
  }
  const bridged = virtualToRealRelative(value, taskId, taskCwd, resolvePath);
  return `${flag.slice(0, eqIndex)}=${bridged}`;
}

/**
 * Bridge sandbox-virtual paths inside inline script source (`-e`/`-c` code,
 * heredoc programs), which real interpreters otherwise resolve against the
 * host filesystem where `/task` and `/mnt` do not exist. Quoted `/task/...`
 * string literals become paths relative to taskCwd (the subprocess cwd) --
 * relative so the host dir never appears in the code and so Windows
 * backslashes never corrupt string escapes. The quote prefix is what
 * distinguishes a string literal from lookalikes such as JS regex literals
 * (`split(/task/)`), which must not be rewritten. Quoted `/mnt/...` literals
 * have no host path a subprocess may receive, at any access level, so they fail
 * fast with the copy-first guidance instead of dereferencing the host root.
 */
export function bridgeInlineCodePaths(
  code: string,
  taskId: TaskId,
  taskCwd: string,
): { code: string } | { error: string } {
  if (quotedMountPattern(MOUNT.attachedFolders).test(code)) {
    return { error: attachedMountLiteralError("Inline script code") };
  }

  // The private dir is masked from the shell and file tools; block inline-code
  // literals too so a real interpreter can't be steered into task.db/state.json
  // via a quoted `/task/.instrument/...` string. Best-effort, like the /mnt
  // guard above.
  if (quotedMountPattern(privateMountPoint(MOUNT.task)).test(code)) {
    return { error: privateDirLiteralError("Inline script code") };
  }

  const relativeTaskRoot =
    path.relative(taskCwd, taskDir(taskId)).replaceAll("\\", "/") || ".";
  return {
    code: code.replaceAll(
      quotedMountPattern(MOUNT.task),
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

/**
 * Parse args, separating the options the command interprets itself from the
 * unrecognized ones (returned in their original `--flag`/`--flag=value` form,
 * so a caller can forward them to the real binary). Unrecognized options are
 * reported via captureException unless the caller forwards them.
 */
export function parseScriptRunnerArgs<
  T extends NonNullable<ParseArgsConfig["options"]>,
>(
  commandName: string,
  args: string[],
  options: T,
  { captureUnknown = true }: { captureUnknown?: boolean } = {},
) {
  const result = parseArgs({
    allowPositionals: true,
    args,
    options,
    strict: false,
    tokens: true,
  });

  const foundIndex = result.tokens.findIndex((t) => t.kind === "positional");
  const firstPositionalIndex = foundIndex === -1 ? Infinity : foundIndex;
  const unknownTokens = result.tokens.filter(
    (t, i) =>
      i < firstPositionalIndex && isOptionToken(t) && !(t.name in options),
  );

  if (captureUnknown && unknownTokens.length > 0) {
    getWorkspaceConfig().captureException(
      new Error(
        `[${commandName}] Unrecognized options ignored: ${unknownTokens
          .map((t) => (isOptionToken(t) ? t.rawName : ""))
          .join(", ")}`,
      ),
    );
  }

  // A value is only attached to an unrecognized option in its inline
  // `--flag=value` form; the space-separated form parses as a positional.
  const unknownFlags = unknownTokens.flatMap((t) =>
    isOptionToken(t)
      ? [t.value === undefined ? t.rawName : `${t.rawName}=${t.value}`]
      : [],
  );

  return { ...result, unknownFlags };
}

/** Guidance for a private-dir reference; subject names the source. */
export function privateDirLiteralError(subject: string): string {
  return (
    `${subject} references the private ${TASK_FOLDER_NAMES.private} directory. ` +
    `It holds task internals (task.db, state.json, settings) and is not readable ` +
    `by real interpreter processes.`
  );
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
  const uvEnv = uvSubprocessEnv({ taskId });
  const shellEnv = { ...Object.fromEntries(ctx.env), ...uvEnv };
  // A task-local temp dir keeps tempfile, os.tmpdir(), and mktemp inside the
  // sandbox instead of the host temp dir; created here if absent (recursive
  // mkdir is a no-op when it exists) because interpreters fail if TMPDIR points
  // at a missing dir.
  const tmpDir = getTaskTmpDir(taskDir(taskId));
  mkdirSync(tmpDir, { recursive: true });
  return {
    // Overlay the uv/python env so the real-binary escape hatches (tsx, node,
    // ffmpeg, uv, python, pip) all resolve `uv`/`python` on PATH and share the
    // task venv. uvSubprocessEnv wins (PATH/VIRTUAL_ENV) over the bash env.
    // gitSubprocessEnv comes last and is handed the env it has to correct, so
    // it can drop every GIT_* the agent exported into the bash env rather than
    // only overriding the ones it sets. It extends the PATH uv just built.
    // TEMP/TMP/TMPDIR win over anything the agent exported so temp files stay
    // inside the task.
    env: {
      ...shellEnv,
      ...gitSubprocessEnv(shellEnv),
      TEMP: tmpDir,
      TMP: tmpDir,
      TMPDIR: tmpDir,
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

/**
 * Read a script FILE the agent is about to run and scan its source for quoted
 * sandbox-virtual path literals a real interpreter cannot resolve, returning an
 * error to surface instead of letting the subprocess fail deep in a stack
 * trace. Fails open: an unreadable or binary file yields undefined so the
 * interpreter produces its own error.
 */
export async function scanScriptFileForVirtualPaths(
  taskCwd: string,
  filePath: string,
): Promise<string | undefined> {
  let source: string;
  try {
    source = await readFile(path.resolve(taskCwd, filePath), "utf8");
  } catch {
    return undefined;
  }
  return scriptFileVirtualPathError(source);
}

/**
 * Error message for a quoted sandbox-virtual path literal in a script FILE's
 * source, or undefined if none. Unlike inline code (bridgeInlineCodePaths),
 * file contents are never rewritten -- the file is the agent's own artifact,
 * and silently diverging what runs from what it wrote is worse than a clear
 * up-front error -- so even bridgeable `/task/...` literals are reported rather
 * than fixed (they otherwise fail with a confusing "Read-only file system:
 * '/task'" that contradicts the agent's instructions). Quote-anchored and
 * best-effort, matching the inline guard: only literals right after a quote
 * match, so regex literals and paths embedded mid-string are left alone.
 */
export function scriptFileVirtualPathError(source: string): string | undefined {
  if (quotedMountPattern(MOUNT.attachedFolders).test(source)) {
    return attachedMountLiteralError("This script file");
  }
  if (quotedMountPattern(privateMountPoint(MOUNT.task)).test(source)) {
    return privateDirLiteralError("This script file");
  }
  if (quotedMountPattern(MOUNT.task).test(source)) {
    return (
      `This script file references a ${MOUNT.task}/... absolute path, which ` +
      `real interpreter processes cannot resolve: ${MOUNT.task} is a virtual ` +
      `path only the sandbox shell and file tools see, and scripts run from the ` +
      `task root. Use a task-relative path instead (output/report.txt, ` +
      `work/data.csv). Command-line path arguments and quoted ${MOUNT.task}/... ` +
      `strings in inline -e/-c code are translated automatically; paths written ` +
      `inside script files are not.`
    );
  }
  return undefined;
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

function isOptionToken(token: { kind: string }): token is {
  kind: "option";
  name: string;
  rawName: string;
  value: string | undefined;
} {
  return token.kind === "option";
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
 * The mount point is regex-escaped so paths with metacharacters (e.g. the `.`
 * in `/task/.instrument`) match literally.
 */
function quotedMountPattern(mountPoint: string): RegExp {
  const escaped = mountPoint.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(['"\`])${escaped}(?=/|\\1)`, "g");
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
