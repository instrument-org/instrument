import ms from "ms";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { publisher } from "../rpc/publisher";
import { type RelativePath, RelativePathSchema } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { BackgroundOutputBuffer } from "./background-output-buffer";
import { BoundedLogWriter } from "./bounded-log-writer";
import { BoundedText } from "./bounded-text";
import { filterShellOutput } from "./filter-shell-output";
import { getCurrentDate } from "./get-current-date";
import { MAX_RUNNING_AGE_MS } from "./shell-commands/background-job-commands";
import {
  type ShellOutputSink,
  withShellOutputSink,
} from "./shell-commands/output-sink";
import { SubprocessTreeTerminationError } from "./subprocess-tree";
import { taskDir } from "./task-dir-utils";

/**
 * How many processes may run at once per task. A ceiling the agent can hit beats
 * an unbounded fleet of forgotten dev servers: refusing the ninth start names
 * the eight that are live, which is the information needed to kill one.
 */
export const MAX_RUNNING_BACKGROUND_PROCESSES = 8;

/** Finished records kept per session so a late poll still finds its exit code. */
const MAX_FINISHED_RECORDS = 32;

/** Pending output held in memory per process. */
const PENDING_OUTPUT_CAP_BYTES = 256 * 1024;

/** Output retained in one process log before later bytes are summarized. */
const LOG_CONTENT_CAP_BYTES = 16 * 1024 * 1024;

/**
 * How long a kill waits for the child to actually exit before settling the record
 * regardless. Longer than execa's own SIGTERM-to-SIGKILL escalation so the normal
 * case reports a real exit.
 */
const TERMINATION_GRACE_MS = ms("6 seconds");

/** Ceiling on what one read may accumulate while it waits out its window. */
const READ_HEAD_BYTES = 512 * 1024;
const READ_TAIL_BYTES = 512 * 1024;

export interface BackgroundProcessInfo {
  command: string;
  durationMs: number;
  /** Absent while running, and for a process killed before it reported one. */
  exitCode?: number;
  id: string;
  /** Task-relative; holds output up to the per-process disk quota. */
  logFilePath: RelativePath;
  /** Output omitted after the process log reached its disk quota. */
  logOmittedBytes: number;
  /** Set when the log could not be written. */
  logWriteError?: string;
  startedAt: Date;
  status: BackgroundProcessStatus;
  totalOutputBytes: number;
}

export interface BackgroundProcessRead {
  info: BackgroundProcessInfo;
  /**
   * Bytes dropped from the front of the pending buffer because output outpaced
   * reads.
   */
  omittedBytes: number;
  /** Output produced since the previous read. */
  output: string;
  /** True when the process was still running when this read stopped waiting. */
  timedOut: boolean;
}

/**
 * A started run that has not (yet) become a background process. Held by the
 * caller for the length of its yield window and then either dropped, because the
 * command finished, or handed to `promoteBackgroundProcess`.
 */
export interface BackgroundRunHandle {
  /** Stops the run. Used for the caller's own cancellation and for kills. */
  abort: () => void;
  readonly buffer: BackgroundOutputBuffer;
  readonly command: string;
  readonly completion: Promise<BackgroundRunOutcome>;
  /**
   * Detaches the caller's abort signal. Called when promoting: the tool call's
   * signal aborts as soon as the call returns, which would kill the process the
   * call just handed off.
   */
  detachCaller: () => void;
  /** Compares final shell output with all live subprocess output by content. */
  matchesStreamedOutput: (output: string) => boolean;
  /** Set at promotion so later chunks reach the log file and wake readers. */
  setChunkListener: (listener: ShellOutputSink) => void;
  readonly startedAt: Date;
}

interface BackgroundProcessRecord {
  ageTimer?: NodeJS.Timeout;
  buffer: BackgroundOutputBuffer;
  command: string;
  endedAt?: Date;
  exitCode?: number;
  handle: BackgroundRunHandle;
  id: string;
  /**
   * Resolves once the log file is closed. A read of a finished process awaits it,
   * so the log path handed to the agent always points at complete contents.
   */
  logClosed: Promise<void>;
  logFilePath: RelativePath;
  logWriter: BoundedLogWriter;
  prePromotionOmittedBytes: number;
  startedAt: Date;
  status: BackgroundProcessStatus;
  /** Set once a stop was asked for, and by what, so the outcome is labeled. */
  stopReason?: StopReason;
  taskId: TaskId;
  waiters: Set<() => void>;
}

type BackgroundProcessStatus =
  | "exited"
  | "expired"
  | "failed"
  | "killed"
  | "running"
  | "termination-uncertain";

type BackgroundRunOutcome =
  | { errorMessage: string; terminationConfirmed: boolean }
  | { exitCode: number; output: string };

/**
 * Why a stop happened, kept apart because the agent reads the two differently.
 * `requested` is somebody deciding this should end; `expired` is the age cap
 * firing on a process nobody asked about, which reported as a kill would have
 * the agent conclude the user stopped the server it was told to run.
 */
type StopReason = "expired" | "requested";

/**
 * Process-local and deliberately not persisted: a record describes a live child
 * process, and nothing survives an app restart for it to describe. Restart
 * recovery would need the processes themselves to be re-attachable.
 *
 * Keyed by session rather than by task. One task can have several sessions live
 * at once -- parallel turns, and every subagent shares its parent's task -- so a
 * task-keyed registry would let one session read and kill another's processes,
 * and would make turn cleanup a cross-session kill.
 */
const recordsBySession = new Map<
  StoreId.Session,
  Map<string, BackgroundProcessRecord>
>();
/** Refuses promotion and lets concurrent callers join session cleanup. */
const cleanupBySession = new Map<StoreId.Session, Promise<void>>();
/**
 * Never reset within a run, and seeded from disk on first use per task. Ids name
 * log files that persisted tool results point at, so reusing one would overwrite
 * the output an earlier turn's transcript promises.
 */
const nextIdByTask = new Map<TaskId, number>();

/**
 * Kills everything, for app shutdown. Child processes normally die with the
 * parent, but a graceful quit should not depend on that.
 */
export async function killAllBackgroundProcesses(): Promise<void> {
  await Promise.all(
    [...recordsBySession.keys()].map((sessionId) =>
      killSessionBackgroundProcesses(sessionId),
    ),
  );
}

export async function killBackgroundProcess({
  id,
  sessionId,
}: {
  id: string;
  sessionId: StoreId.Session;
}): Promise<
  | undefined
  | {
      info: BackgroundProcessInfo;
      stoppedByThisCall: boolean;
      terminationConfirmed: boolean;
    }
> {
  const record = recordsBySession.get(sessionId)?.get(id);
  if (!record) {
    return undefined;
  }
  // Reported rather than derived from the final status: a process killed earlier
  // still reads as "killed", and telling the agent it just stopped something it
  // had already stopped is a small lie that compounds.
  const stoppedByThisCall = record.status === "running";
  if (stoppedByThisCall) {
    await stopRecord(record);
  }
  // This result points the agent at the log file, so it has to be complete.
  await record.logClosed;
  return {
    info: toInfo(record),
    stoppedByThisCall,
    terminationConfirmed: record.status !== "termination-uncertain",
  };
}

/**
 * Kills everything one session started, without touching another session's
 * processes even when they belong to the same task. For a subagent session
 * ending, since nothing will poll it again. The id counter is left alone.
 */
export function killSessionBackgroundProcesses(
  sessionId: StoreId.Session,
): Promise<void> {
  const activeCleanup = cleanupBySession.get(sessionId);
  if (activeCleanup) {
    return activeCleanup;
  }

  const cleanup = Promise.resolve().then(async () => {
    try {
      const records = recordsBySession.get(sessionId);
      if (!records) {
        return;
      }
      const running = [...records.values()].filter(
        (record) => record.status === "running",
      );
      const confirmed = await Promise.all(
        running.map((record) => stopRecord(record)),
      );
      // Only what this call tried to stop. A record left `termination-uncertain`
      // by an earlier kill is not running now and cannot be stopped again, so
      // counting it would make every later cleanup of this session fail and
      // never release its records.
      if (confirmed.some((stopped) => !stopped)) {
        throw new Error(
          `Could not confirm that every background process for session ${sessionId} stopped.`,
        );
      }
      const taskIds = new Set(
        [...records.values()].map(({ taskId }) => taskId),
      );
      recordsBySession.delete(sessionId);
      for (const taskId of taskIds) {
        publishChanged(taskId);
      }
    } finally {
      cleanupBySession.delete(sessionId);
    }
  });
  cleanupBySession.set(sessionId, cleanup);
  return cleanup;
}

/** Kills everything running for a task; for trashing one. */
export async function killTaskBackgroundProcesses(
  taskId: TaskId,
): Promise<void> {
  await Promise.all(
    [...recordsBySession.entries()].map(async ([sessionId, records]) => {
      if ([...records.values()].some((record) => record.taskId === taskId)) {
        await killSessionBackgroundProcesses(sessionId);
      }
    }),
  );
}

export function listBackgroundProcesses(
  sessionId: StoreId.Session,
): BackgroundProcessInfo[] {
  const records = recordsBySession.get(sessionId);
  if (!records) {
    return [];
  }
  return [...records.values()]
    .map((record) => toInfo(record))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Everything running in one task, across every session in it.
 *
 * Ownership stays per-session -- a session may only read and kill its own -- but
 * a user looking at a task does not know sessions exist, and the subagents of a
 * turn each have one. What they left running is the task's, so the surfaces that
 * show it and the cap that bounds it are both task-wide.
 */
export function listTaskBackgroundProcesses(
  taskId: TaskId,
): (BackgroundProcessInfo & { sessionId: StoreId.Session })[] {
  return [...recordsBySession.entries()]
    .flatMap(([sessionId, records]) =>
      [...records.values()]
        .filter((record) => record.taskId === taskId)
        .map((record) => ({ ...toInfo(record), sessionId })),
    )
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Turns a run that outlived its yield window into a background process the agent
 * can read from and kill by id. Until this is called a run has no id and no log
 * file, so an ordinary bash command leaves nothing behind.
 */
export function promoteBackgroundProcess({
  handle,
  sessionId,
  taskId,
}: {
  handle: BackgroundRunHandle;
  /** Owns the process: reads, kills, and turn cleanup are all scoped to it. */
  sessionId: StoreId.Session;
  /** Only locates the log file; ownership is the session's. */
  taskId: TaskId;
}): { error: string } | { info: BackgroundProcessInfo } {
  if (cleanupBySession.has(sessionId)) {
    return {
      error:
        "This session is closing, so it cannot start a background process.",
    };
  }
  const records =
    recordsBySession.get(sessionId) ??
    new Map<string, BackgroundProcessRecord>();
  recordsBySession.set(sessionId, records);

  reapFinished(records);

  const running = [...recordsBySession.entries()].flatMap(
    ([recordsSessionId, sessionRecords]) =>
      [...sessionRecords.values()]
        .filter(
          (record) => record.taskId === taskId && record.status === "running",
        )
        .map((record) => ({
          ownedHere: recordsSessionId === sessionId,
          record,
        })),
  );
  if (running.length >= MAX_RUNNING_BACKGROUND_PROCESSES) {
    // The cap counts the whole task, but a kill only reaches the session that
    // started the process. Naming another session's id would prescribe a step
    // that comes back "no background process", so those are counted, not named.
    const ownRunning = running.filter((entry) => entry.ownedHere);
    const elsewhere = running.length - ownRunning.length;
    return {
      error: [
        `Too many background processes already running for this task (${running.length}).`,
        ownRunning.length > 0 &&
          `Kill one before starting another: ${ownRunning
            .map(({ record }) => `${record.id} (${record.command})`)
            .join(", ")}.`,
        elsewhere > 0 &&
          `${elsewhere} of them ${elsewhere === 1 ? "was" : "were"} started by another session and cannot be stopped from here.`,
      ]
        .filter((part) => typeof part === "string")
        .join(" "),
    };
  }

  const id = allocateId(taskId);

  const log = openLogFile({ id, taskId });
  if ("error" in log) {
    return { error: log.error };
  }
  const { logFileAbsolutePath, logFilePath } = log;

  const logWriter = new BoundedLogWriter({
    maxContentBytes: LOG_CONTENT_CAP_BYTES,
    path: logFileAbsolutePath,
  });
  const record: BackgroundProcessRecord = {
    buffer: handle.buffer,
    command: handle.command,
    handle,
    id,
    // Resolves on error too: a log we could not write is still not going to
    // arrive, and blocking a read on it forever would be worse.
    logClosed: logWriter.closed,
    logFilePath,
    logWriter,
    prePromotionOmittedBytes: handle.buffer.omittedBytesSoFar(),
    startedAt: handle.startedAt,
    status: "running",
    taskId,
    waiters: new Set(),
  };
  records.set(id, record);
  const ageRemaining = Math.max(
    0,
    MAX_RUNNING_AGE_MS -
      (getCurrentDate().getTime() - handle.startedAt.getTime()),
  );
  record.ageTimer = setTimeout(() => {
    void stopRecord(record, "expired");
  }, ageRemaining);
  record.ageTimer.unref();

  // The tool call that started the run is about to return; its signal aborts on
  // the way out and would take the process with it.
  handle.detachCaller();

  const prePromotionDrop = record.prePromotionOmittedBytes;
  void record.logWriter.write(
    `$ ${handle.command}\n` +
      (prePromotionDrop > 0
        ? `[${prePromotionDrop} bytes written before this process was promoted were dropped]\n`
        : "") +
      handle.buffer.snapshot(),
  );
  handle.setChunkListener(async (text) => {
    // Output can still arrive after a kill has settled the record and closed the
    // stream; the buffer keeps it for a final read, the log does not.
    if (record.status !== "running") {
      return;
    }
    await record.logWriter.write(text);
    notify(record);
  });

  void handle.completion.then((outcome) => {
    finish({ outcome, record });
  });

  publishChanged(taskId);
  return { info: toInfo(record) };
}

/**
 * Returns output produced since the previous read, collecting for up to
 * `waitMs` and returning early only when the process finishes.
 *
 * Collecting for the whole window rather than returning at the first chunk is
 * what makes a read worth its tool call: a dev server that logs a line every
 * half second would otherwise hand back one line per call.
 */
export async function readBackgroundProcess({
  id,
  sessionId,
  signal,
  waitMs,
}: {
  id: string;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  waitMs: number;
}): Promise<BackgroundProcessRead | undefined> {
  const record = recordsBySession.get(sessionId)?.get(id);
  if (!record) {
    return undefined;
  }

  const deadline = getCurrentDate().getTime() + waitMs;
  // Bounded: a chatty process and a long `waitMs` would otherwise accumulate
  // without limit inside a single read.
  const collected = new BoundedText({
    headBytes: READ_HEAD_BYTES,
    tailBytes: READ_TAIL_BYTES,
  });
  let omittedBytes = 0;

  for (;;) {
    const drained = record.buffer.drain();
    collected.write(drained.text);
    omittedBytes += drained.omittedBytes;

    if (record.status !== "running" || signal?.aborted) {
      break;
    }
    const remaining = deadline - getCurrentDate().getTime();
    if (remaining <= 0) {
      break;
    }
    await waitForChange({ record, signal, waitMs: remaining });
  }

  if (record.status !== "running") {
    // The read reports the log path as the complete record; make sure it is one.
    await record.logClosed;
  }

  return {
    info: toInfo(record),
    omittedBytes: omittedBytes + collected.omittedBytes,
    output: collected.toString(),
    timedOut: record.status === "running",
  };
}

/**
 * Starts `run` with an output sink installed, so every native-binary shim
 * beneath it streams its lines into the returned handle's buffer as they are
 * written. Nothing is registered yet; see `promoteBackgroundProcess`.
 */
export function startBackgroundRun({
  callerSignal,
  command,
  run,
  taskId,
}: {
  /** Cancels the run until it is promoted; typically the tool call's signal. */
  callerSignal: AbortSignal;
  command: string;
  run: (options: { signal: AbortSignal }) => Promise<{
    exitCode: number;
    output: string;
  }>;
  /** Locates the task dir the streamed copy is redacted against. */
  taskId: TaskId;
}): BackgroundRunHandle {
  const buffer = new BackgroundOutputBuffer({
    capBytes: PENDING_OUTPUT_CAP_BYTES,
  });
  const abortController = new AbortController();
  const abort = () => {
    abortController.abort();
  };
  callerSignal.addEventListener("abort", abort);
  // A signal that aborted before the run started never fires its listener, so
  // without this a command the user had already stopped would run to completion
  // and, if it outlived its window, be promoted.
  if (callerSignal.aborted) {
    abort();
  }

  let chunkListener: ShellOutputSink | undefined;
  const streamedHash = createHash("sha256");
  let streamedEndsWithNewline = false;
  const sink: ShellOutputSink = async (rawText) => {
    // The one place every streamed chunk passes through before it becomes
    // model-visible and lands in the process log, so redaction belongs here
    // rather than in each shim: a shim redacts only the value it returns, which
    // is the copy a foreground call reports, not the copy a promoted one streams.
    // Line-anchored patterns hold because the sink is handed whole lines.
    //
    // Separators are left alone. Rewriting them exists to make a Windows path
    // usable as a tool input, and the authoritative final shell output already
    // does that; applying it to a live view would corrupt backslashes inside
    // matched lines for no gain.
    const text = filterShellOutput(rawText, taskDir(taskId), {
      rewriteSeparators: false,
    });
    // Redaction can empty a chunk that arrived non-empty, and a chunk that adds
    // nothing must not be treated as one. Recording it would clear the
    // ends-with-newline flag, which makes the streamed digest disagree with the
    // final shell output and reports the whole command's output a second time.
    if (!text) {
      return;
    }
    streamedHash.update(comparableOutput(text));
    streamedEndsWithNewline = text.endsWith("\n");
    buffer.write(text);
    await chunkListener?.(text);
  };

  const completion = withShellOutputSink(sink, () =>
    run({ signal: abortController.signal }),
  ).then(
    (result): BackgroundRunOutcome => result,
    (error: unknown): BackgroundRunOutcome => ({
      // An abort surfaces here as a rejection; an empty message marks it as the
      // kill it was, so the agent is not told its own `bash_kill` errored.
      errorMessage:
        abortController.signal.aborted &&
        !(error instanceof SubprocessTreeTerminationError)
          ? ""
          : error instanceof Error
            ? error.message
            : String(error),
      terminationConfirmed: !(error instanceof SubprocessTreeTerminationError),
    }),
  );

  return {
    abort,
    buffer,
    command,
    completion,
    detachCaller: () => {
      callerSignal.removeEventListener("abort", abort);
    },
    matchesStreamedOutput: (output) => {
      if (buffer.totalBytes === 0) {
        return output === "";
      }
      if (!output) {
        return false;
      }
      const normalizedStream = streamedHash.copy();
      if (!streamedEndsWithNewline) {
        normalizedStream.update("\n");
      }
      const comparable = comparableOutput(output);
      const normalizedOutput = comparable.endsWith("\n")
        ? comparable
        : `${comparable}\n`;
      return (
        normalizedStream.digest("hex") ===
        createHash("sha256").update(normalizedOutput).digest("hex")
      );
    },
    setChunkListener: (listener) => {
      chunkListener = listener;
    },
    startedAt: getCurrentDate(),
  };
}

/**
 * Hands out the next `bg_N` for a task, seeding from the log files already on
 * disk the first time a task is seen.
 *
 * The counter lives in memory, so without the seed a restart would begin again at
 * `bg_1` and the write stream, which truncates, would overwrite a log that a
 * transcript from before the restart still points at. That is worse than a
 * missing file: the log would then hold some later command's output under the
 * earlier one's name.
 */
function allocateId(taskId: TaskId): string {
  let next = nextIdByTask.get(taskId);

  if (next === undefined) {
    const outputDir = absolutePathJoin(
      taskDir(taskId),
      TASK_FOLDER_NAMES.work,
      TASK_FOLDER_NAMES.toolOutput,
    );
    let highest = 0;
    try {
      for (const name of fs.readdirSync(outputDir)) {
        const match = /^bg_(\d+)\.log$/.exec(name);
        const parsed = match?.[1] === undefined ? 0 : Number(match[1]);
        highest = Math.max(highest, parsed);
      }
    } catch {
      // No output directory yet, so nothing has claimed an id for this task.
    }
    next = highest + 1;
  }

  nextIdByTask.set(taskId, next + 1);
  return `bg_${next}`;
}

/**
 * Live output comes from native subprocesses below the shell, so redirects and
 * pipelines can make the shell's final output differ. Append that final result
 * when its content differs, while avoiding duplicate output for ordinary calls.
 */
function appendFinalOutput({
  output,
  record,
}: {
  output: string;
  record: BackgroundProcessRecord;
}) {
  if (record.buffer.totalBytes === 0) {
    if (output) {
      const terminated = output.endsWith("\n") ? output : `${output}\n`;
      record.buffer.write(terminated);
      void record.logWriter.write(terminated);
    }
    return;
  }
  if (record.handle.matchesStreamedOutput(output)) {
    return;
  }
  const finalOutput = output
    ? `[final shell output]\n${output.endsWith("\n") ? output : `${output}\n`}`
    : "[final shell output was empty; earlier live subprocess output was consumed or redirected by the shell]\n";
  record.buffer.write(finalOutput);
  void record.logWriter.write(`\n${finalOutput}`);
}

/**
 * The form the streamed and final copies are compared in.
 *
 * They are redacted with different separator handling on purpose: the live view
 * keeps backslashes because rewriting them would corrupt matched content, and
 * the final output rewrites them so a Windows path is usable as a tool input.
 * Comparing the two verbatim would therefore call every backslash-bearing
 * command's output "different" and report all of it a second time.
 */
function comparableOutput(text: string): string {
  return text.replaceAll("\\", "/");
}

function finish({
  outcome,
  record,
}: {
  outcome: BackgroundRunOutcome;
  record: BackgroundProcessRecord;
}) {
  if (record.status !== "running") {
    if (
      record.status === "termination-uncertain" &&
      (!("errorMessage" in outcome) || outcome.terminationConfirmed)
    ) {
      // A stop that timed out settled the record already; the process running
      // on and then exiting is the answer the agent was actually owed, so take
      // its code and its last output now. The log closed with the first pass,
      // so that output reaches the buffer alone.
      if (!("errorMessage" in outcome)) {
        record.exitCode = outcome.exitCode;
        appendFinalOutput({ output: outcome.output, record });
      }
      record.status = stoppedStatus(record) ?? "failed";
      notify(record);
      publishChanged(record.taskId);
    }
    return;
  }
  record.endedAt = getCurrentDate();
  clearTimeout(record.ageTimer);

  // A stop that was asked for reads as a stop however the run happened to end,
  // so that a race between the kill and the process exiting on its own does not
  // change what the agent is told it did.
  const requested = stoppedStatus(record);
  if ("errorMessage" in outcome) {
    record.status = outcome.terminationConfirmed
      ? (requested ?? (outcome.errorMessage ? "failed" : "killed"))
      : "termination-uncertain";
    if (outcome.errorMessage) {
      record.buffer.write(`${outcome.errorMessage}\n`);
      void record.logWriter.write(`${outcome.errorMessage}\n`);
    }
  } else {
    record.exitCode = outcome.exitCode;
    record.status = requested ?? (outcome.exitCode === 0 ? "exited" : "failed");
    appendFinalOutput({ output: outcome.output, record });
  }

  record.logWriter.close();
  notify(record);
  publishChanged(record.taskId);
}

function notify(record: BackgroundProcessRecord) {
  for (const waiter of record.waiters) {
    waiter();
  }
  record.waiters.clear();
}

/**
 * Opens the log a promoted process writes to. Failure is returned rather than
 * thrown: this runs before the record is registered and before the caller's
 * signal is detached, so a throw here would leave a detached process that
 * nothing lists, nothing can stop, and quit cleanup cannot reach.
 */
function openLogFile({ id, taskId }: { id: string; taskId: TaskId }):
  | { error: string }
  | {
      logFileAbsolutePath: ReturnType<typeof absolutePathJoin>;
      logFilePath: ReturnType<typeof RelativePathSchema.parse>;
    } {
  try {
    const logFilePath = RelativePathSchema.parse(
      path.posix.join(
        TASK_FOLDER_NAMES.work,
        TASK_FOLDER_NAMES.toolOutput,
        `${id}.log`,
      ),
    );
    const logFileAbsolutePath = absolutePathJoin(taskDir(taskId), logFilePath);
    fs.mkdirSync(path.dirname(logFileAbsolutePath), { recursive: true });
    return { logFileAbsolutePath, logFilePath };
  } catch (error) {
    return {
      error: `Could not open a log file for the background process: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Tells the surfaces showing this to the user that the set changed.
 *
 * Deliberately not in `notify`, which fires on every chunk of output: a process
 * printing ten lines a second would publish ten times a second, and what a
 * viewer needs is only whether the process is still there. Appearing, ending
 * and being removed are the only three moments that answer that.
 */
function publishChanged(taskId: TaskId) {
  publisher.publish("backgroundProcesses.changed", { id: taskId });
}

/** Drops stale finished records. */
function reapFinished(records: Map<string, BackgroundProcessRecord>) {
  const finished = [...records.values()]
    .filter((record) => record.status !== "running")
    .sort((a, b) => (a.endedAt?.getTime() ?? 0) - (b.endedAt?.getTime() ?? 0));

  // Only the in-memory record goes. The log file stays: persisted tool results
  // name it, so deleting it would break a promise an earlier turn already made to
  // the model and to anyone reading the transcript.
  for (const record of finished.slice(
    0,
    Math.max(0, finished.length - MAX_FINISHED_RECORDS),
  )) {
    records.delete(record.id);
  }
}

/** The terminal status a stop produces, or nothing if none was asked for. */
function stoppedStatus(
  record: BackgroundProcessRecord,
): BackgroundProcessStatus | undefined {
  switch (record.stopReason) {
    case "expired": {
      return "expired";
    }
    case "requested": {
      return "killed";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Stops a run and waits for it to actually be gone.
 *
 * Aborting only asks: execa sends SIGTERM and escalates on its own schedule, so a
 * process can outlive the abort by seconds. Reporting the kill before the child
 * exits would claim a port is free when it is not, and would close the log before
 * the process's shutdown output arrived. The bounded wait means a child ignoring
 * SIGTERM cannot hang the turn either -- past the deadline the record is settled
 * anyway and says so.
 */
async function stopRecord(
  record: BackgroundProcessRecord,
  reason: StopReason = "requested",
) {
  if (record.status !== "running") {
    return record.status !== "termination-uncertain";
  }
  record.stopReason = reason;
  record.handle.abort();

  const settled = await Promise.race([
    record.handle.completion.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, TERMINATION_GRACE_MS).unref();
    }),
  ]);

  finish({
    outcome: {
      errorMessage: settled
        ? ""
        : `Did not exit within ${TERMINATION_GRACE_MS} ms of being stopped; it may still be running.`,
      terminationConfirmed: settled,
    },
    record,
  });
  return toInfo(record).status !== "termination-uncertain";
}

function toInfo(record: BackgroundProcessRecord): BackgroundProcessInfo {
  return {
    command: record.command,
    durationMs:
      (record.endedAt ?? getCurrentDate()).getTime() -
      record.startedAt.getTime(),
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    id: record.id,
    logFilePath: record.logFilePath,
    logOmittedBytes: record.logWriter.omittedBytes,
    ...(record.logWriter.errorMessage
      ? { logWriteError: record.logWriter.errorMessage }
      : {}),
    startedAt: record.startedAt,
    status: record.status,
    totalOutputBytes: record.buffer.totalBytes,
  };
}

function waitForChange({
  record,
  signal,
  waitMs,
}: {
  record: BackgroundProcessRecord;
  signal?: AbortSignal;
  waitMs: number;
}): Promise<void> {
  if (record.status !== "running" || record.buffer.hasPending()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    // A holder rather than a plain binding: the timeout's callback is also what
    // clears the timeout, so one of the two would have to reference the other
    // before it is assigned.
    const pending: { timer?: NodeJS.Timeout } = {};
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(pending.timer);
      record.waiters.delete(done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    pending.timer = setTimeout(done, waitMs);
    record.waiters.add(done);
    signal?.addEventListener("abort", done, { once: true });
  });
}
