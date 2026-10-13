import { type ByteString, latin1FromBytes } from "just-bash";
import { mkdirSync } from "node:fs";
import { parseArgs, type ParseArgsConfig } from "node:util";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { gitSubprocessEnv } from "../git";
import { getChatTmpDir } from "../chat-dir-utils";
import { uvSubprocessEnv } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import { hostPathOf } from "../workspace-fs-layout";
import { workDir } from "../work-dir";

/**
 * Arguments for a native subprocess. Paths pass through as written; on
 * Windows an absolute path in the shell's spelling (`/c/Users/sam`, bare or as
 * a `--flag=` value) becomes the host's (`C:\\Users\\sam`). A drive letter
 * alone (`/c`, `/d/`) is left as it is: it is far more often one of
 * Windows' switches (`cmd /c`, `dir /s`) than a drive's root.
 */
export function hostPathArgs(args: string[]): string[] {
  if (process.platform !== "win32") {
    return args;
  }
  return args.map((arg) => {
    const eq = arg.startsWith("-") ? arg.indexOf("=") : -1;
    const value = arg.slice(eq + 1);
    return /^\/[a-z]\/./i.test(value)
      ? `${arg.slice(0, eq + 1)}${hostPathOf(value)}`
      : arg;
  });
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

/** Resolve the effective cwd and env for a shell command. */
export function resolveCommandContext(
  chatId: ChatId,
  ctx: {
    cwd: string;
    env: Map<string, string>;
    fs: { resolvePath(cwd: string, path: string): string };
  },
) {
  const uvEnv = uvSubprocessEnv({ chatId });
  const shellEnv: Record<string, string> = {
    ...Object.fromEntries(ctx.env),
    ...uvEnv,
  };
  // The shell's TZ is an IANA name (America/Chicago), which Windows' C
  // runtime does not read: it takes TZ as `CST6CDT` or nothing, and a name
  // it cannot parse puts a program's local time hours off. Without one it
  // uses the system's zone, which is the same zone.
  if (process.platform === "win32" && shellEnv.TZ?.includes("/")) {
    delete shellEnv.TZ;
  }
  // A task-local temp dir keeps tempfile, os.tmpdir(), and mktemp inside the
  // sandbox instead of the host temp dir; created here if absent (recursive
  // mkdir is a no-op when it exists) because interpreters fail if TMPDIR points
  // at a missing dir.
  const tmpDir = getChatTmpDir(workDir(chatId));
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
    taskCwd: AbsolutePathSchema.parse(
      hostPathOf(ctx.fs.resolvePath(ctx.cwd, ".")),
    ),
  };
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
