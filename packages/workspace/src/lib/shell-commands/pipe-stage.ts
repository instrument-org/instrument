import {
  type ByteString,
  type CommandContext,
  type ExecResult,
  latin1FromBytes,
} from "just-bash";
import {
  type ChildProcess,
  spawn,
  type StdioOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:os";
import { PassThrough, type Readable } from "node:stream";

import { inheritedEnv } from "../native-env";
import { SCRIPT_CHANNEL_FD, type ScriptChannel } from "../capabilities/channel";
import {
  NativeSandboxUnavailableError,
  wrapNativeCommand,
} from "../native-sandbox";
import { watchSubprocessTree } from "../subprocess-tree";
import { execShim, launchWithChannel, withShimNotes } from "./exec-shim";
import {
  collectAndForward,
  currentShellOutputSink,
  decodeForDisplay,
} from "./output-sink";

/**
 * Native pipeline stages joined by OS pipes.
 *
 * just-bash runs a pipeline's stages in turn and hands each one the previous
 * stage's whole stdout. A local part of its patch (`native-pipes-3.6.0.diff`)
 * lets a stage return while it is still writing, with a handoff for its
 * stdout, and lets the next stage take that handoff instead of the bytes.
 * Between two native programs that means a kernel pipe: the consumer gets the
 * producer's stdout as its fd 0, the bytes never pass through this process,
 * and a consumer that exits early (`head`) ends the producer with SIGPIPE, as
 * in a real shell. A stage that is not a program gets the bytes by settling
 * the handoff, as it would have without one.
 */

/** Streams a stage left for the next one, by the token the shell carries. */
const handoffStreams = new Map<string, Readable>();

/**
 * Producers' stdouts a relayed consumer stopped reading before they ended.
 * Windows has no SIGPIPE, so such a producer fails its next write and says so
 * on stderr; it is reported as a POSIX one would end.
 */
const cutOff = new WeakSet<Readable>();

/** What a program prints when the pipe it writes to has closed on Windows. */
const BROKEN_PIPE = /Broken pipe|pipe is being closed|os error 232/i;

/** What a finished stage reports, shaped like `execShim`'s result. */
export interface StageResult {
  exitCode: number | undefined;
  file: string;
  isMaxBuffer: boolean;
  shortMessage?: string;
  stderr: string;
  /** stdout decoded as UTF-8, for reading what the program said. */
  stdout: string;
  /** stdout exactly as the program wrote it. */
  stdoutBytes: Buffer;
}

export interface StageHandoff {
  token: string;
  settle(options?: {
    discard?: boolean;
    signal?: AbortSignal;
  }): Promise<StageResult>;
}

export interface StageOptions {
  cancelSignal?: AbortSignal;
  cwd: string;
  env?: Record<string, string>;
  /** Bytes for fd 0. Without them, and without `stdinHandoff`, fd 0 is closed. */
  input?: Buffer;
  /** Stop the program once its stdout passes this many bytes, as execa's `maxBuffer`. */
  maxStdout?: number;
  /**
   * Where the program calls `instrument`, closed once it exits. Its calls run under
   * the stage's signal, which for a stage handing its stdout on stops after
   * its command.
   */
  scriptChannel?: ScriptChannel;
  /** Return at once with a handoff for stdout instead of waiting. */
  offerHandoff: boolean;
  /** The previous stage's handoff token, taken as fd 0. */
  stdinHandoff?: string;
  /** An open file for fd 0, which the program reads as its stdin. */
  stdinFd?: number;
  /** The environment is `env` alone, with nothing of the app's own. */
  ownEnvOnly?: true;
  unsandboxed?: true;
  windowsVerbatimArguments?: boolean;
}

type PipeHandle = { readStart(): number; readStop(): number; reading: boolean };

/**
 * The libuv pipe behind a child's stdio stream. Node keeps it private, and it
 * is the only way to stop Node reading a child's stdout before the next
 * program takes it: libuv starts reading as soon as Node wraps the pipe, and
 * nothing public pauses that (a paused stream still fills its buffer). A
 * FIFO from `mkfifo` would need a process per pipe, since Node has no
 * `mkfifo`, and has no Windows counterpart. A stage checks the shape before
 * relying on it and stays buffered when it differs, and `pipe-stage.test.ts`
 * fails if a Node upgrade changes what it does.
 */
export function pipeHandle(stream: Readable): PipeHandle | undefined {
  const handle: unknown = Reflect.get(stream, "_handle");
  if (
    typeof handle === "object" &&
    handle !== null &&
    typeof Reflect.get(handle, "readStop") === "function" &&
    typeof Reflect.get(handle, "readStart") === "function" &&
    typeof Reflect.get(handle, "reading") === "boolean"
  ) {
    // Checked member by member just above; Node types none of it.
    return handle as PipeHandle;
  }
  return undefined;
}

/** Stop Node reading a stream, so every byte stays in the pipe. */
function holdUnread(stream: Readable): boolean {
  const handle = pipeHandle(stream);
  if (!handle) {
    return false;
  }
  handle.readStop();
  handle.reading = false;
  return true;
}

/** Start reading a stream `holdUnread` stopped. */
function resumeReading(stream: Readable) {
  const handle = pipeHandle(stream);
  if (handle && !handle.reading) {
    handle.reading = true;
    handle.readStart();
  }
}

/**
 * Whether stages may hand their stdout on. `INSTRUMENT_NATIVE_PIPES=0` keeps
 * every stage on the buffered path, for comparing the two. Where the private
 * pipe handle is not what `holdUnread` expects, each stage finds that out
 * itself and finishes on the buffered path.
 */
function pipeHandoffsSupported(): boolean {
  return process.env.INSTRUMENT_NATIVE_PIPES !== "0";
}

/**
 * Close a stream no stage read the way a pipe closes when its reader exits:
 * a kernel pipe holds 64 KiB, so a producer that writes less than that
 * finishes normally, and one that writes more sees the closed pipe.
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

/** The status a shell reports: the exit code, or 128 plus the signal. */
function shellStatus(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) {
    return code;
  }
  return signal ? 128 + (constants.signals[signal] ?? 0) : undefined;
}

/**
 * Run a native program as one stage of a pipeline: under the same sandbox
 * wrap, environment, output sink and process-tree kill as `execShim`, with
 * its fd 0 the previous native stage's stdout when the shell handed over a
 * token. With `offerHandoff` it returns at once with a handoff for its
 * stdout.
 *
 * Each stage is its own process under its own wrap, so a refusal is read
 * from that stage's own stderr. A stage whose stdout goes on to the next
 * program forwards only its stderr to a background run's sink; the last
 * stage forwards both, so the live view shows what the pipeline prints.
 */
export function startPipeStage(
  file: string,
  args: string[],
  options: StageOptions,
): StageHandoff | Promise<StageResult> {
  let spawned: ReturnType<typeof wrapNativeCommand>;
  try {
    spawned = wrapNativeCommand(
      file,
      args,
      options.unsandboxed ? null : undefined,
    );
  } catch (error) {
    options.scriptChannel?.close();
    if (!(error instanceof NativeSandboxUnavailableError)) {
      throw error;
    }
    // 126, the shell's "found but could not run".
    return Promise.resolve({
      exitCode: 126,
      file,
      isMaxBuffer: false,
      stderr: `${error.message}\n`,
      stdout: "",
      stdoutBytes: Buffer.alloc(0),
    });
  }
  const sink = currentShellOutputSink();
  const upstream =
    options.stdinHandoff === undefined
      ? undefined
      : handoffStreams.get(options.stdinHandoff);
  if (options.stdinHandoff !== undefined) {
    handoffStreams.delete(options.stdinHandoff);
  }
  // The stage's own stop. A stage that hands its stdout on outlives its
  // command, whose context (and signal) the shell revokes once it returns,
  // so from then on the signal `settle` is given is the one that stops it.
  const stop = new AbortController();
  const linkCancel = (signal: AbortSignal | undefined) => {
    if (signal?.aborted) {
      stop.abort();
    } else {
      signal?.addEventListener("abort", () => stop.abort(), { once: true });
    }
  };
  if (!options.offerHandoff) {
    linkCancel(options.cancelSignal);
  }
  // On Windows the stage's end of the previous stage's pipe is the one libuv
  // opened for overlapped I/O, and a program that reads its stdin
  // synchronously (uutils, ripgrep: Rust's std) aborts on it with
  // "operation failed to complete synchronously". There the bytes are relayed
  // through this process instead, still as a stream with backpressure.
  const relay = upstream !== undefined && process.platform === "win32";
  const stdio: StdioOptions = [
    relay
      ? "pipe"
      : (upstream ?? (options.input ? "pipe" : (options.stdinFd ?? "ignore"))),
    "pipe",
    "pipe",
  ];
  let child: ChildProcess;
  try {
    const { launch, spawnEnv, tokenLine } = launchWithChannel(
      spawned,
      {
        ...(options.ownEnvOnly ? {} : inheritedEnv(process.env, spawned)),
        ...options.env,
      },
      options.scriptChannel,
      {
        cwd: options.cwd,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
      },
    );
    child = spawn(launch.file, launch.args, {
      cwd: options.cwd,
      // A background run's kill signals the process group the child leads.
      detached: sink !== undefined && process.platform !== "win32",
      env: spawnEnv,
      // Descriptor 3 is the token's line, written and closed just below.
      stdio: tokenLine ? [...stdio, "pipe"] : stdio,
      windowsHide: true,
      // Under MXC the program's command line is in the launcher's request.
      windowsVerbatimArguments:
        spawned.kind === "mxc" ? false : options.windowsVerbatimArguments,
    });
  } finally {
    // The program holds its own copy of the read end now. Closing ours is
    // what lets the producer see a closed pipe once this stage exits.
    if (!relay) {
      upstream?.destroy();
    }
  }
  if (relay && upstream && child.stdin) {
    const stdin = child.stdin;
    // A stage that exits early closes its stdin; the producer then finds
    // its pipe closed, as it would reading straight from it.
    const close = () => {
      if (!upstream.readableEnded) {
        cutOff.add(upstream);
      }
      upstream.destroy();
    };
    stdin.on("error", close);
    child.once("close", close);
    upstream.on("error", () => stdin.destroy());
    upstream.pipe(stdin);
    resumeReading(upstream);
  }
  const tokenPipe = child.stdio[SCRIPT_CHANNEL_FD];
  if (options.scriptChannel?.handOver.tokenLine && tokenPipe) {
    tokenPipe.on("error", () => {});
    if ("end" in tokenPipe) {
      tokenPipe.end(options.scriptChannel.handOver.tokenLine);
    }
  }
  const handsOn =
    options.offerHandoff && child.stdout !== null && holdUnread(child.stdout);
  // Bytes the shell gave a stage only stand in for the pipe it did not get.
  if (options.input && child.stdin && !relay) {
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  }
  if (options.scriptChannel) {
    const channel = options.scriptChannel;
    channel.attach(stop.signal);
    child.once("close", () => channel.close());
    child.once("error", () => channel.close());
  }
  const finishTreeTermination = sink
    ? watchSubprocessTree({ pid: child.pid, signal: stop.signal })
    : undefined;
  if (!sink) {
    stop.signal.addEventListener("abort", () => child.kill("SIGTERM"), {
      once: true,
    });
  }

  // What goes to a background run's live view: stderr always, stdout only
  // when this stage prints it rather than handing it on.
  const live = sink ? new PassThrough() : undefined;
  const streamed = live && sink ? collectAndForward(live, sink) : undefined;
  let liveOpen = handsOn ? 1 : 2;
  const endLive = () => {
    liveOpen -= 1;
    if (liveOpen === 0) {
      live?.end();
    }
  };
  const stderr = collect(child.stderr, live, endLive).then(decodeForDisplay);
  let isMaxBuffer = false;
  const collectStdout = () =>
    collect(child.stdout, live, endLive, options.maxStdout, () => {
      isMaxBuffer = true;
      stop.abort();
    });

  let spawnError: Error | undefined;
  const exited = new Promise<number | undefined>((resolve) => {
    child.on("error", (error) => {
      spawnError = error;
      resolve(undefined);
    });
    child.on("close", (code, signal) => resolve(shellStatus(code, signal)));
  });
  const finish = async (stdout: Promise<Buffer>): Promise<StageResult> => {
    const [status, written, outBytes] = await Promise.all([
      exited,
      stderr,
      stdout,
    ]);
    const out = outBytes.toString("utf8");
    await streamed;
    // A producer whose reader stopped early ends as it would on POSIX: the
    // status of SIGPIPE, and none of its complaint about the closed pipe.
    // Some (uutils' seq) exit 0 after saying so, which counts the same.
    const wasCutOff = child.stdout !== null && cutOff.has(child.stdout);
    const lines = written.split(/(?<=\n)/);
    const err = wasCutOff
      ? lines.filter((line) => !BROKEN_PIPE.test(line)).join("")
      : written;
    const exitCode =
      wasCutOff && (status !== 0 || err !== written) ? 141 : status;
    await finishTreeTermination?.();
    const noted = withShimNotes({
      exitCode,
      file,
      reach: spawned.reach,
      stderr: err,
      stdout: out,
    });
    return {
      exitCode: noted.exitCode,
      file,
      isMaxBuffer,
      shortMessage: spawnError?.message,
      stderr: noted.stderr,
      stdout: isMaxBuffer ? "" : out,
      stdoutBytes: isMaxBuffer ? Buffer.alloc(0) : outBytes,
    };
  };
  if (!handsOn || !child.stdout) {
    return finish(collectStdout());
  }
  const token = randomUUID();
  const stdout = child.stdout;
  handoffStreams.set(token, stdout);
  let settled: Promise<StageResult> | undefined;
  return {
    settle({ discard = false, signal } = {}) {
      linkCancel(signal);
      settled ??= (() => {
        const untaken = handoffStreams.delete(token);
        if (untaken && !discard) {
          // A consumer that is not a program reads the bytes here.
          liveOpen += 1;
          const out = collectStdout();
          resumeReading(stdout);
          return finish(out);
        }
        if (untaken) {
          absorbThenClose(stdout);
        }
        return finish(Promise.resolve(Buffer.alloc(0)));
      })();
      return settled;
    },
    token,
  };
}

/**
 * Read a stream's bytes to the end, copying each chunk to `live` when a
 * background run is watching. Past `max` bytes it calls `onMax` and keeps
 * nothing more.
 */
function collect(
  stream: Readable | null,
  live: PassThrough | undefined,
  onEnd: () => void,
  max = Number.POSITIVE_INFINITY,
  onMax?: () => void,
): Promise<Buffer> {
  if (!stream) {
    onEnd();
    return Promise.resolve(Buffer.alloc(0));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve) => {
    const done = () => {
      onEnd();
      resolve(Buffer.concat(chunks));
    };
    stream.on("data", (chunk: Buffer) => {
      if (size > max) {
        return;
      }
      size += chunk.length;
      if (size > max) {
        onMax?.();
        return;
      }
      chunks.push(chunk);
      live?.write(chunk);
    });
    stream.once("error", done);
    stream.once("close", done);
  });
}

/** The stdin a stage reads when it does not take a handoff. */
type StageStdin = { input: Buffer } | { stdin: "ignore" };

/** The bytes a command was given as its stdin, or a closed fd 0 for none. */
export function stdinFor(stdin: ByteString): StageStdin {
  const packed = latin1FromBytes(stdin);
  return packed
    ? { input: Buffer.from(packed, "latin1") }
    : { stdin: "ignore" };
}

/**
 * Run a native program for a shell command, joining it to a neighboring
 * native stage by an OS pipe where the shell offers that, and through
 * `execShim` otherwise. `report` turns the finished program into the
 * command's result; for a stage that hands its stdout on it runs when the
 * shell settles the handoff.
 */
export async function runNative(
  ctx: Pick<CommandContext, "offerPipeHandoff" | "signal" | "stdinHandoff">,
  file: string,
  args: string[],
  options: Omit<StageOptions, "input" | "offerHandoff" | "stdinHandoff"> &
    StageStdin & { maxBuffer?: { stdout: number } },
  report: (result: StageResult) => ExecResult | Promise<ExecResult>,
): Promise<ExecResult> {
  const piped = ctx.offerPipeHandoff === true || ctx.stdinHandoff !== undefined;
  // An open file for fd 0 is a spawn's own stdio, which execa does not take;
  // a stage takes it the same way, piped or not.
  if (options.stdinFd === undefined && (!piped || !pipeHandoffsSupported())) {
    const {
      maxBuffer,
      maxStdout: _maxStdout,
      stdinFd: _stdinFd,
      ...shimOptions
    } = options;
    const result = await execShim(file, args, {
      ...shimOptions,
      ...(maxBuffer ? { maxBuffer } : {}),
    });
    return report({ ...result, isMaxBuffer: result.isMaxBuffer === true });
  }
  const stage = startPipeStage(file, args, {
    ...options,
    input: "input" in options ? options.input : undefined,
    maxStdout: options.maxBuffer?.stdout ?? options.maxStdout,
    offerHandoff: ctx.offerPipeHandoff === true && pipeHandoffsSupported(),
    stdinHandoff: ctx.stdinHandoff,
  });
  if (!("token" in stage)) {
    return report(await stage);
  }
  return {
    exitCode: 0,
    pipeHandoff: {
      settle: async (settleOptions) =>
        report(await stage.settle(settleOptions)),
      token: stage.token,
    },
    stderr: "",
    stdout: "",
  };
}
