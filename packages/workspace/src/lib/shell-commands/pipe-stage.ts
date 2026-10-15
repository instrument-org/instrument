import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Readable } from "node:stream";
import { constants } from "node:os";

import { inheritedEnv } from "../native-env";
import {
  NativeSandboxUnavailableError,
  refusalNote,
  refusedPathIn,
  wrapNativeCommand,
} from "../native-sandbox";

/**
 * Streams a native pipeline stage left for the next stage, by the token the
 * shell carries between them. The shell never reads one: a native consumer
 * takes it as its fd 0, so the bytes go from one program to the next through
 * an OS pipe, and anything else gets them by settling the handoff.
 */
const handoffStreams = new Map<string, Readable>();

/** What a finished stage reports, before the command's own output mapping. */
export interface StageResult {
  exitCode: number | undefined;
  file: string;
  shortMessage?: string;
  stderr: string;
  stdout: string;
}

export interface StageHandoff {
  token: string;
  settle(options?: {
    discard?: boolean;
    signal?: AbortSignal;
  }): Promise<StageResult>;
}

/**
 * Libuv starts reading a child's stdout as soon as Node wraps it. A stream
 * handed to the next program has to keep every byte in the pipe, so reading
 * stops before the event loop turns, and resumes only if the shell settles
 * the handoff for a consumer that is not a program.
 */
function holdUnread(stream: Readable) {
  const handle = pipeHandle(stream);
  if (handle) {
    handle.readStop();
    handle.reading = false;
  }
}

/** Start reading a stream `holdUnread` stopped, for a consumer that is not a program. */
function resumeReading(stream: Readable) {
  const handle = pipeHandle(stream);
  if (handle && !handle.reading) {
    handle.reading = true;
    handle.readStart();
  }
}

/**
 * Close a stream no stage read the way a pipe whose reader exited closes: a
 * kernel pipe holds 64 KiB, so a producer that writes less than that finishes
 * normally, and one that writes more sees the closed pipe (SIGPIPE, 141).
 */
function absorbThenClose(stream: Readable) {
  let absorbed = 0;
  stream.on("data", (chunk: Buffer) => {
    absorbed += chunk.length;
    if (absorbed > PIPE_CAPACITY) {
      stream.destroy();
    }
  });
  stream.on("error", () => {});
  resumeReading(stream);
}

const PIPE_CAPACITY = 64 * 1024;

/** The libuv pipe behind a child's stdio stream; Node keeps it private. */
function pipeHandle(stream: Readable) {
  return (
    stream as unknown as {
      _handle?: { readStart(): number; readStop(): number; reading: boolean };
    }
  )._handle;
}

function collect(stream: Readable | null): Promise<string> {
  if (!stream) {
    return Promise.resolve("");
  }
  const chunks: Buffer[] = [];
  return new Promise((resolve) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** The status a shell reports: the exit code, or 128 plus the signal. */
function shellStatus(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) {
    return code;
  }
  return signal ? 128 + (constants.signals[signal] ?? 0) : undefined;
}

/**
 * Run a native program as one stage of a pipeline. Its fd 0 is the previous
 * native stage's stdout when the shell handed over a token, the bytes the
 * shell gave otherwise. When `offerHandoff` is set it returns at once with a
 * handoff for its stdout instead of waiting for the program to finish.
 *
 * Each stage is its own process under its own sandbox wrap, so a refusal is
 * read from that stage's stderr alone, as `execShim` reads it.
 */
export function startPipeStage(
  file: string,
  args: string[],
  options: {
    cancelSignal?: AbortSignal;
    cwd: string;
    env: Record<string, string>;
    input?: Buffer;
    offerHandoff: boolean;
    stdinHandoff?: string;
  },
): StageHandoff | Promise<StageResult> {
  let spawned: ReturnType<typeof wrapNativeCommand>;
  try {
    spawned = wrapNativeCommand(file, args);
  } catch (error) {
    if (!(error instanceof NativeSandboxUnavailableError)) {
      throw error;
    }
    const failed: StageResult = {
      exitCode: 126,
      file,
      stderr: `${error.message}\n`,
      stdout: "",
    };
    return options.offerHandoff
      ? { settle: () => Promise.resolve(failed), token: "" }
      : Promise.resolve(failed);
  }
  const upstream =
    options.stdinHandoff === undefined
      ? undefined
      : handoffStreams.get(options.stdinHandoff);
  if (options.stdinHandoff !== undefined) {
    handoffStreams.delete(options.stdinHandoff);
  }
  let child: ChildProcess;
  try {
    child = spawn(spawned.file, spawned.args, {
      cwd: options.cwd,
      env: { ...inheritedEnv(process.env, spawned.reach), ...options.env },
      // A stage that hands its stdout on outlives its command context, whose
      // signal is aborted when it returns; `settle` is given the run's own.
      signal: options.offerHandoff ? undefined : options.cancelSignal,
      stdio: [upstream ?? (options.input ? "pipe" : "ignore"), "pipe", "pipe"],
    });
  } finally {
    // The program holds its own copy of the read end now. Closing ours is
    // what lets the producer see a closed pipe once this stage exits.
    upstream?.destroy();
  }
  if (options.offerHandoff && child.stdout) {
    holdUnread(child.stdout);
  }
  const kill = () => child.kill("SIGTERM");
  if (options.input && child.stdin) {
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  }
  const stderr = collect(child.stderr);
  let spawnError: Error | undefined;
  const exited = new Promise<number | undefined>((resolve) => {
    child.on("error", (error) => {
      spawnError = error;
      resolve(undefined);
    });
    child.on("close", (code, signal) => resolve(shellStatus(code, signal)));
  });
  const finish = async (stdout: Promise<string>): Promise<StageResult> => {
    const [exitCode, err, out] = await Promise.all([exited, stderr, stdout]);
    const refused =
      spawned.reach && exitCode !== 0
        ? refusedPathIn(`${err}\n${out}`, spawned.reach, options.cwd)
        : undefined;
    const note = refused && refusalNote(refused);
    return {
      exitCode,
      file,
      shortMessage: spawnError?.message,
      stderr: note
        ? `${err}${err.endsWith("\n") || err === "" ? "" : "\n"}${note}\n`
        : err,
      stdout: out,
    };
  };
  if (!options.offerHandoff || !child.stdout) {
    return finish(collect(child.stdout));
  }
  const token = randomUUID();
  const stdout = child.stdout;
  handoffStreams.set(token, stdout);
  let settled: Promise<StageResult> | undefined;
  return {
    settle({ discard = false, signal } = {}) {
      if (signal?.aborted) {
        kill();
      } else {
        signal?.addEventListener("abort", kill, { once: true });
      }
      settled ??= (() => {
        const untaken = handoffStreams.delete(token);
        if (untaken && discard) {
          absorbThenClose(stdout);
        }
        if (untaken && !discard) {
          const out = collect(stdout);
          resumeReading(stdout);
          return finish(out);
        }
        return finish(Promise.resolve(""));
      })();
      return settled;
    },
    token,
  };
}
