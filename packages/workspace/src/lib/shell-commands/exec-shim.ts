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
    // Set when the subprocess failed without producing output of its own, which
    // is the only diagnostic a shim can report in that case.
    shortMessage: result.shortMessage,
  };
}
