import { execFile } from "node:child_process";
import os from "node:os";

/** What one run of the helper or of a script answered. */
export interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * What the Mac apps' tools run on: the Swift helper's JSON commands, for
 * Calendar, Reminders and Contacts, and the app's own AppleScript, for Mail,
 * Notes and Messages. A test or an eval hands the server one of its own.
 */
export interface MacAppBackend {
  /** One helper command, or undefined in a build without the helper. */
  helper?: (args: string[], signal?: AbortSignal) => Promise<RunResult>;
  /** One of the app's scripts, with the values it reads as `on run argv`. */
  script: (
    script: string,
    values: string[],
    signal?: AbortSignal,
  ) => Promise<RunResult>;
}

/**
 * Where macOS keeps it. Not bundled: it ships with every Mac, and the Apple
 * Events it sends are attributed to the app that started it, which is what
 * the system asks the person about.
 */
const OSASCRIPT_PATH = "/usr/bin/osascript";

/** Enough for a long list of messages or notes. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Starts `file` as a plain child of this process, which is a child of the
 * app: nothing here disclaims responsibility, so macOS holds the app
 * responsible for it, and its prompts and its grants are Instrument's. Only
 * what a program needs of the environment goes along.
 */
function run(
  file: string,
  args: string[],
  signal: AbortSignal | undefined,
): Promise<RunResult> {
  const env = Object.fromEntries(
    ["HOME", "LANG", "LC_ALL", "TMPDIR", "USER"].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        env,
        maxBuffer: MAX_OUTPUT_BYTES,
        signal,
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({
          exitCode: code,
          stderr: stderr || (error && code === 1 ? error.message : ""),
          stdout,
        });
      },
    );
  });
}

/**
 * The backend the server runs on in the app: the helper at `helperPath`
 * where the build carries it, and `osascript -e <script> -- <values>`,
 * past whose `--` nothing reads as an option.
 */
export function systemBackend(helperPath: string | undefined): MacAppBackend {
  return {
    ...(helperPath !== undefined && {
      helper: (args, signal) => run(helperPath, args, signal),
    }),
    script: (script, values, signal) =>
      run(OSASCRIPT_PATH, ["-e", script, "--", ...values], signal),
  };
}
