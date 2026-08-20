import { execa, type Options } from "execa";

import { watchSubprocessTree } from "../subprocess-tree";
import { collectAndForward, currentShellOutputSink } from "./output-sink";

/**
 * Options a shim may set. The output-shaping ones are fixed by `execShim`, so
 * they are excluded rather than merely overridden: leaving them settable would
 * let a caller ask for buffers or line arrays, and the merged output this
 * returns is a string by construction.
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
 * Run a real binary on behalf of a sandbox command, with the settings every
 * shim needs to behave like a shell command rather than a library call:
 *
 * - `all` merges stdout and stderr in the order the process wrote them. That
 *   ordering is only available here: the interpreter carries a single output
 *   buffer per command, so a shim handing back two separate streams would have
 *   to concatenate them and lose the interleaving.
 * - `stripFinalNewline` is off. execa drops a subprocess's trailing newline by
 *   default; because the interpreter concatenates each command's output, losing
 *   it runs one command's last line into the next command's first.
 * - `reject` is off so a non-zero exit arrives as an exit code, the way a shell
 *   reports it, rather than as a thrown error.
 *
 * When a background run has installed an output sink, the merged stream is read
 * here instead of by execa so lines reach the sink as the process writes them.
 * execa's own buffering is off in that case; two consumers of one stream would
 * each get a share of the chunks rather than the whole thing.
 */
export async function execShim(
  file: string,
  args: string[],
  options: ShimOptions,
) {
  const sink = currentShellOutputSink();
  const { cancelSignal, ...subprocessOptions } = options;
  const subprocess = execa(file, args, {
    ...subprocessOptions,
    all: true,
    buffer: sink === undefined,
    cancelSignal: sink ? undefined : cancelSignal,
    detached: sink !== undefined && process.platform !== "win32",
    reject: false,
    stripFinalNewline: false,
  });
  const finishTreeTermination = sink
    ? watchSubprocessTree({ pid: subprocess.pid, signal: cancelSignal })
    : undefined;
  const streamed = sink ? collectAndForward(subprocess.all, sink) : undefined;
  const result = await subprocess;
  await finishTreeTermination?.();
  return {
    // execa types `all` as optional (only populated when asked for) and as
    // possibly an array (when `lines` is on). It is always asked for here and
    // `lines` is not settable, so the string branch is the only reachable one;
    // narrowing rather than asserting keeps that guarantee checked.
    all: streamed
      ? await streamed
      : typeof result.all === "string"
        ? result.all
        : "",
    exitCode: result.exitCode,
    // The binary that was launched, kept so a diagnostic can name the command
    // the way the agent spells it rather than by its path on this machine.
    file,
    // Set when the subprocess failed without producing output of its own, which
    // is the only diagnostic a shim can report in that case.
    shortMessage: result.shortMessage,
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
 * the sandbox otherwise never shows -- `filterShellOutput` masks the task dir
 * and the home dir, neither of which covers a path inside an installed app
 * bundle. That opening line is dropped and any remaining mention of the binary
 * becomes the command name, leaving the part that actually diagnoses the
 * failure: which cwd was invalid, or which file was not found.
 */
export function shimOutput(
  result: {
    all: string;
    exitCode: number | undefined;
    file?: string;
    shortMessage?: string;
  },
  commandName: string,
): string {
  if (result.exitCode !== undefined) {
    return result.all;
  }
  if (result.all) {
    return result.all;
  }

  const detail = (result.shortMessage ?? "")
    .split("\n")
    .slice(1)
    .map((line) =>
      result.file ? line.replaceAll(result.file, commandName) : line,
    )
    .join("\n")
    .trim();

  return detail
    ? `${commandName} could not start.\n${detail}\n`
    : `${commandName} failed without diagnostic output.\n`;
}
