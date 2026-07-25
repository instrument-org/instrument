import { execa, type Options } from "execa";

/**
 * Options a shim may set. The output-shaping ones are fixed by `execShim`, so
 * they are excluded rather than merely overridden: leaving them settable would
 * let a caller ask for buffers or line arrays, and the merged output this
 * returns is a string by construction.
 */
type ShimOptions = Omit<
  Options,
  "all" | "buffer" | "encoding" | "lines" | "reject" | "stripFinalNewline"
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
 */
export async function execShim(
  file: string,
  args: string[],
  options: ShimOptions,
) {
  const result = await execa(file, args, {
    ...options,
    all: true,
    reject: false,
    stripFinalNewline: false,
  });
  return {
    // execa types `all` as optional (only populated when asked for) and as
    // possibly an array (when `lines` is on). It is always asked for here and
    // `lines` is not settable, so the string branch is the only reachable one;
    // narrowing rather than asserting keeps that guarantee checked.
    all: typeof result.all === "string" ? result.all : "",
    exitCode: result.exitCode,
    // Set when the subprocess failed without producing output of its own, which
    // is the only diagnostic a shim can report in that case.
    shortMessage: result.shortMessage,
  };
}
