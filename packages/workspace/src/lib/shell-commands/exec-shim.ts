import { execa, type Options } from "execa";

/** A finished subprocess's two output streams, kept apart. */
export interface ShimStreams {
  stderr: string;
  stdout: string;
}

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
 */
export async function execShim(
  file: string,
  args: string[],
  options: ShimOptions,
) {
  const result = await execa(file, args, {
    ...options,
    reject: false,
    stripFinalNewline: false,
  });
  return {
    exitCode: result.exitCode,
    // The binary that was launched, kept so a diagnostic can name the command
    // the way the agent spells it rather than by its path on this machine.
    file,
    // Set when the subprocess failed without producing output of its own, which
    // is the only diagnostic a shim can report in that case.
    shortMessage: result.shortMessage,
    // execa types these as possibly an array (when `lines` is on) or a buffer
    // (when `encoding` is set). Neither is settable here, so the string branch
    // is the only reachable one; narrowing rather than asserting keeps that
    // guarantee checked.
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
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
 * the sandbox otherwise never shows -- `filterShellOutput` masks the task dir
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
