import { execa, type Options } from "execa";
import { bytesOutput, unsafeBytesFromLatin1 } from "just-bash";
import { isUtf8 } from "node:buffer";
import { statSync } from "node:fs";
import path from "node:path";

import { commandLineToolsNote } from "../command-line-tools-env";
import { inheritedEnv } from "../native-env";
import { type ToolsChannel } from "../node-tools-preload";

import {
  launchNative,
  type NativeReach,
  NativeSandboxUnavailableError,
  packageScopeNote,
  wrapNativeCommand,
} from "../native-sandbox";

import { watchSubprocessTree } from "../subprocess-tree";
import { WINDOW_COMMAND } from "./window-command";
import {
  collectAndForward,
  currentShellOutputSink,
  decodeForDisplay,
} from "./output-sink";

/** A finished subprocess's two output streams, kept apart. */
export interface ShimStreams {
  stderr: string;
  stdout: string;
}

/**
 * Options a shim may set. The output-shaping ones are fixed by `execShim`, so
 * they are excluded rather than merely overridden: leaving them settable would
 * let a caller ask for line arrays or a different decoding, and this returns
 * stdout as its exact bytes and as UTF-8 text by construction.
 *
 * `detached` is fixed for a different reason: `watchSubprocessTree` signals the
 * process group named by the child's own pid, which is a group only because the
 * child leads one. A shim that turned detaching off would leave that signal with
 * no group to find, and a kill would report success having stopped nothing.
 */
type ShimOptions = Omit<
  Options,
  | "all"
  | "buffer"
  | "detached"
  | "encoding"
  | "lines"
  | "reject"
  | "stripFinalNewline"
>;

/**
 * Keep only the last state of each carriage-return progress line, which is what
 * a terminal would have shown.
 *
 * A tool that redraws a counter in place writes one enormous line: `git clone`
 * does it with "Updating files: 1%...2%", ffmpeg with a `frame=... speed=...`
 * line per second. A long run arrives as tens of kilobytes on a single line, so
 * line-based truncation cannot trim it and it buries whatever the command
 * actually reported.
 */
export function collapseProgress(output: string) {
  // The pattern tries a match at every character, a second per 35 MB, so
  // output with no carriage return at all skips it.
  if (!output.includes("\r")) {
    return output;
  }
  // The lookahead spares \r\n, so Windows line endings are left intact.
  return output.replaceAll(/[^\n]*\r(?!\n)/g, "");
}

/**
 * Run a real binary on behalf of a sandbox command, with the settings every
 * shim needs to behave like a shell command rather than a library call:
 *
 * - stdout and stderr are kept apart, because that is what makes a redirection
 *   mean what it says. Merging them costs the agent the interleaving of a
 *   process that writes to both, but handing the merged text back as stdout
 *   costs far more: `cmd > file` writes the diagnostics into the file and
 *   leaves the agent an empty result to explain a non-zero exit, and
 *   `2>/dev/null` silences nothing because nothing is on stderr to silence.
 *   Real bash separates them under redirection too.
 * - `stripFinalNewline` is off. execa drops a subprocess's trailing newline by
 *   default; because the interpreter concatenates each command's output, losing
 *   it runs one command's last line into the next command's first.
 * - `reject` is off so a non-zero exit arrives as an exit code, the way a shell
 *   reports it, rather than as a thrown error.
 *
 * When a background run has installed an output sink, a second reader of the
 * merged stream forwards lines to it as the process writes them. execa tees
 * that stream rather than handing it over, so buffering stays on and the split
 * streams above remain authoritative: the sink shows the interleaving a
 * terminal would have, and a redirection still means what it says.
 */
export async function execShim(
  file: string,
  args: string[],
  options: ShimOptions & {
    /** Where the program calls tools, closed once it exits. */
    toolsChannel?: ToolsChannel;
    /**
     * Run outside the native sandbox: only for a command the person allowed
     * to act on its own, such as a script to an app they allowed.
     */
    unsandboxed?: true;
    /**
     * The environment is `env` alone, with nothing of the app's own: for a
     * program run outside the sandbox on an environment built for it.
     */
    ownEnvOnly?: true;
  },
) {
  const sink = currentShellOutputSink();
  const {
    cancelSignal,
    toolsChannel,
    ownEnvOnly,
    unsandboxed,
    ...subprocessOptions
  } = options;
  let spawned: ReturnType<typeof wrapNativeCommand>;
  try {
    spawned = wrapNativeCommand(file, args, unsandboxed ? null : undefined);
  } catch (error) {
    if (!(error instanceof NativeSandboxUnavailableError)) {
      throw error;
    }
    toolsChannel?.close();
    // 126, the shell's "found but could not run".
    return {
      exitCode: 126,
      file,
      isMaxBuffer: false,
      shortMessage: undefined,
      stderr: `${error.message}\n`,
      stdout: "",
      stdoutBytes: Buffer.alloc(0),
    };
  }
  // Only what a program needs of the app's own environment, so a key or
  // token set for the app never reaches a script the agent runs.
  const env = {
    ...(ownEnvOnly ? {} : inheritedEnv(process.env, spawned)),
    ...subprocessOptions.env,
  };
  const launch = launchNative(spawned, {
    cwd:
      typeof subprocessOptions.cwd === "string"
        ? subprocessOptions.cwd
        : undefined,
    env,
    windowsVerbatimArguments: subprocessOptions.windowsVerbatimArguments,
  });
  const subprocess = execa(launch.file, launch.args, {
    ...subprocessOptions,
    env,
    // Under MXC the program's command line is in the launcher's request,
    // and the launcher's own arguments take Node's quoting.
    ...(spawned.kind === "mxc" ? { windowsVerbatimArguments: false } : {}),
    extendEnv: false,
    all: true,
    cancelSignal: sink ? undefined : cancelSignal,
    detached: sink !== undefined && process.platform !== "win32",
    // Bytes, so stdout reaches the shell as the program wrote it; decoding
    // it is up to whoever reads it as text.
    encoding: "buffer",
    reject: false,
    stripFinalNewline: false,
  });
  if (cancelSignal) {
    toolsChannel?.attach(cancelSignal);
  }
  const finishTreeTermination = sink
    ? watchSubprocessTree({ pid: subprocess.pid, signal: cancelSignal })
    : undefined;
  const streamed = sink
    ? collectAndForward(subprocess.readable({ from: "all" }), sink)
    : undefined;
  const result = await subprocess;
  toolsChannel?.close();
  await streamed;
  await finishTreeTermination?.();
  const stderr = decodeForDisplay(asBuffer(result.stderr));
  const stdoutBytes = asBuffer(result.stdout);
  const stdout = stdoutBytes.toString("utf8");
  const noted = withShimNotes({
    exitCode: result.exitCode,
    file,
    reach: spawned.reach,
    stderr,
    stdout,
  });
  return {
    exitCode: noted.exitCode,
    // The binary that was launched, kept so a diagnostic can name the command
    // the way the agent spells it rather than by its path on this machine.
    file,
    // Set when the subprocess was stopped for passing a `maxBuffer` the shim
    // passed in, so what it wrote is a prefix rather than the whole output.
    isMaxBuffer: result.isMaxBuffer,
    // Set when the subprocess failed without producing output of its own, which
    // is the only diagnostic a shim can report in that case.
    shortMessage: result.shortMessage,
    stderr: noted.stderr,
    stdout,
    stdoutBytes,
  };
}

/**
 * One of execa's buffered outputs as a Buffer over the same memory. With
 * `encoding: "buffer"` and `lines` unsettable, a Uint8Array is the only shape
 * it can take; narrowing rather than asserting keeps that checked.
 */
function asBuffer(output: unknown): Buffer {
  return output instanceof Uint8Array
    ? Buffer.from(output.buffer, output.byteOffset, output.byteLength)
    : Buffer.alloc(0);
}

/**
 * A native program's stdout for the shell when it is not UTF-8 text: its
 * exact bytes, marked as bytes, so a redirect writes them and the next
 * command reads them unchanged. Only the shell's final output decodes them,
 * for display. Text gives nothing here and keeps the string the command
 * rendered from it (redacted, progress collapsed), which the shell encodes
 * as UTF-8; the rendering's line handling would corrupt bytes. A program
 * that writes `data` (an archive) gets its bytes passed on even where they
 * happen to decode as UTF-8, as an uncompressed tar of text files does.
 */
export function binaryStdout(
  result: { stdoutBytes: Buffer },
  { data = false }: { data?: boolean } = {},
) {
  const bytes = result.stdoutBytes;
  return bytes.length === 0 || (!data && isUtf8(bytes))
    ? {}
    : bytesOutput(unsafeBytesFromLatin1(bytes.toString("latin1")));
}

/**
 * A finished program's exit code and stderr with what the app adds to them:
 * the notes for a package.json, a setuid program, a signal, a program that
 * sandboxes itself or an `open` the sandbox refused, and the note for a
 * developer tool stub on a Mac without the tools.
 */
export function withShimNotes({
  exitCode,
  file,
  reach,
  stderr,
  stdout,
}: {
  exitCode: number | undefined;
  file: string;
  reach: NativeReach | undefined;
  stderr: string;
  stdout: string;
}): { exitCode: number | undefined; stderr: string } {
  // Node stopped by a package.json the sandbox refused it is told how to get
  // past that, rather than asked about a folder that holds no work.
  const packageScope =
    exitCode === 0 ? undefined : packageScopeNote(`${stderr}\n${stdout}`);
  // A program that runs as another user is refused whole, and the path the
  // refusal names is the program's, which no card or administrator opens.
  const setuid =
    reach && exitCode !== 0 ? setuidRefusalNote(file, stderr) : undefined;
  const signals =
    exitCode === 0
      ? undefined
      : signalRefusalNote(file, `${stderr}\n${stdout}`);
  const selfSandbox =
    exitCode === 0
      ? undefined
      : (selfSandboxNote(file, `${stderr}\n${stdout}`) ??
        openRefusalNote(file, `${stderr}\n${stdout}`));
  // A program that reached a developer tool stub on a Mac without the tools
  // fails with the stub's own error, which does not say what to do.
  // `xcode-select --install` reports a request the sandbox refused and still
  // exits 0, so its own output is read whatever the exit code, and it fails.
  const installRefused =
    path.basename(file) === "xcode-select" &&
    `${stderr}\n${stdout}`.includes("no install could be requested");
  const missingTools =
    exitCode !== 0 || installRefused
      ? commandLineToolsNote(`${stderr}\n${stdout}`)
      : undefined;
  const notes = [
    ...(packageScope ? [`${packageScope}\n`] : []),
    ...(setuid ? [`${setuid}\n`] : []),
    ...(signals ? [`${signals}\n`] : []),
    ...(selfSandbox ? [`${selfSandbox}\n`] : []),
    ...(missingTools ? [missingTools] : []),
  ].join("");
  return {
    exitCode: installRefused && exitCode === 0 ? 1 : exitCode,
    stderr: notes
      ? `${stderr}${stderr.endsWith("\n") || stderr === "" ? "" : "\n"}${notes}`
      : stderr,
  };
}

/** Programs that signal processes by pid or name. */
const SIGNALING_PROGRAMS: ReadonlySet<string> = new Set([
  "kill",
  "killall",
  "pkill",
]);

/**
 * What the agent reads when `kill`, `pkill` or `killall` ran as a program and
 * the sandbox kept it from a process: each command runs in a sandbox of its
 * own, which reaches only what that command started. On macOS the signal is
 * refused; on Linux the process is not there to be found.
 */
export function signalRefusalNote(
  file: string,
  output: string,
): string | undefined {
  const name = path.basename(file);
  if (!SIGNALING_PROGRAMS.has(name)) {
    return undefined;
  }
  const refused =
    output.includes("Operation not permitted") ||
    (process.platform === "linux" &&
      /No such process|no process found/.test(output));
  return refused
    ? `${name} reaches only processes started in this same command. Stop one you started earlier with the shell's \`kill <pid>\` or \`kill bg_1\`; any other process belongs to the person.`
    : undefined;
}

/**
 * What a program prints when it sandboxes itself and is refused inside the
 * shell's sandbox. On macOS Seatbelt does not nest: Quick Look's `qlmanage`
 * and every program that calls `sandbox_init` fail, and `log` checks first
 * and declines. On Linux bubblewrap's user namespace leaves no room for
 * another: a nested `bwrap` (Flatpak, Chromium's sandbox) blames the kernel,
 * and `snap-confine` refuses every snap.
 */
const SELF_SANDBOX_REFUSALS: Partial<Record<NodeJS.Platform, RegExp>> = {
  darwin:
    /sandbox initialization failed: Operation not permitted|Cannot run while sandboxed/,
  linux:
    /No permissions to create a new namespace|snap-confine has elevated permissions and is not confined/,
};

/**
 * The note for a program that could not start because it puts itself in a
 * sandbox of its own, which no rule or card can open, so the agent moves to
 * another program rather than retrying or asking for a folder.
 */
export function selfSandboxNote(
  file: string,
  output: string,
): string | undefined {
  if (!SELF_SANDBOX_REFUSALS[process.platform]?.test(output)) {
    return undefined;
  }
  // The shell runs `log` by name outside the sandbox (unsandboxed-log.ts).
  if (process.platform === "darwin" && output.includes("log: Cannot run")) {
    return "Run `log` as a shell command of its own (`log show --last 1h`), where it reads the system log; a program, a script or `/usr/bin/log` can't start it.";
  }
  return `\`${path.basename(file)}\` (or a program it started) can't run here: it won't run inside another sandbox, and every command here runs in one, so trying again or asking the person won't help. Use another program for the same work.`;
}

/**
 * The note for an opener the sandbox keeps from starting apps: macOS `open`,
 * which then reports only a Launch Services error code, and Linux
 * `xdg-open`, which finds no desktop session and reports each text browser
 * it fell back to as not found.
 */
export function openRefusalNote(
  file: string,
  output: string,
): string | undefined {
  const name = path.basename(file);
  const refused =
    (process.platform === "darwin" &&
      name === "open" &&
      output.includes("_LSOpen")) ||
    (process.platform === "linux" && name === "xdg-open");
  return refused
    ? `\`${name}\` can't start apps from here. To show the person a file, folder or page, use \`${WINDOW_COMMAND.name} show <path or url>\`.`
    : undefined;
}

/**
 * How to run a process lister that a program or script tried to start: the
 * shell runs it by name outside the sandbox (unsandboxed-process-list.ts).
 */
const PROCESS_LISTERS: Record<string, string> = {
  ps: "Run `ps` as a shell command of its own (`ps aux | grep node`), where it lists every process; a program or script can't start it.",
  top: "Run `top -l 1` as a shell command of its own, where it lists every process; a program or script can't start it.",
};

/**
 * The note for a program macOS kept from starting inside the sandbox because
 * it runs as another user (`ps`, `top`, `sudo`), in place of the note for a
 * refused path, which would send the agent to an administrator for its own
 * binary.
 */
export function setuidRefusalNote(
  file: string,
  stderr: string,
): string | undefined {
  if (process.platform !== "darwin" || !stderr.includes(file)) {
    return undefined;
  }
  if (!/Operation not permitted/.test(stderr) || !runsAsOwner(file)) {
    return undefined;
  }
  const name = path.basename(file);
  const instead = PROCESS_LISTERS[name];
  return `\`${name}\` can't run here: it runs as another user, which the sandbox refuses.${instead ? ` ${instead}` : ""}`;
}

/** The set-user-id bit of a file's mode, which Node's constants leave out. */
const SET_USER_ID = 0o4000;

/** Whether a program runs as its file's owner (setuid) rather than its caller. */
function runsAsOwner(file: string): boolean {
  try {
    return (statSync(file).mode & SET_USER_ID) !== 0;
  } catch {
    return false;
  }
}

/** Apply a text transform to both streams of a finished shim. */
export function mapStreams(
  streams: ShimStreams,
  transform: (text: string) => string,
): ShimStreams {
  return {
    stderr: transform(streams.stderr),
    stdout: transform(streams.stdout),
  };
}

/**
 * The output to report for a finished shim, with a diagnostic substituted when
 * the subprocess never ran.
 *
 * A process that fails to spawn -- a cwd that does not exist, a missing binary
 * -- writes nothing, and every shim coerces its missing exit code to 1. The
 * agent then sees a bare `exit 1` with no text whatsoever, which is the least
 * debuggable failure the sandbox can produce: nothing distinguishes it from a
 * command that ran and legitimately found nothing, so the agent guesses.
 * `shortMessage` is execa's description of the spawn failure.
 *
 * The test is `exitCode === undefined`, which execa sets only when the process
 * did not run; a process that ran and exited non-zero always reports a number.
 * Output is otherwise passed through untouched, because empty output alongside
 * a non-zero exit is an ordinary and meaningful result -- it is how `rg`
 * reports no matches and how `git diff --quiet` reports a difference.
 *
 * The message is sanitized before it goes out. execa opens `shortMessage` with
 * `Command failed with <code>: <resolved binary> <args>`, and the resolved
 * binary is a real host path (the bundled dugite git, the app's ffmpeg) that
 * the sandbox otherwise never shows -- `filterShellOutput` masks the chat's folder
 * and the home dir, neither of which covers a path inside an installed app
 * bundle. That opening line is dropped and any remaining mention of the binary
 * becomes the command name, leaving the part that actually diagnoses the
 * failure: which cwd was invalid, or which file was not found.
 */
export function shimOutput(
  result: {
    exitCode: number | undefined;
    file?: string;
    shortMessage?: string;
    stderr: string;
    stdout: string;
  },
  commandName: string,
): ShimStreams {
  const streams = { stderr: result.stderr, stdout: result.stdout };
  if (result.exitCode !== undefined) {
    return streams;
  }
  if (result.stdout || result.stderr) {
    return streams;
  }

  const detail = (result.shortMessage ?? "")
    .split("\n")
    .slice(1)
    .map((line) =>
      result.file ? line.replaceAll(result.file, commandName) : line,
    )
    .join("\n")
    .trim();

  // A spawn failure is a diagnostic, so it goes where diagnostics go.
  return {
    stderr: detail
      ? `${commandName} could not start.\n${detail}\n`
      : `${commandName} failed without diagnostic output.\n`,
    stdout: "",
  };
}
