import { defineCommand } from "just-bash";
import ms from "ms";
import os from "node:os";

import { type StoreId } from "../../schemas/store-id";
import {
  type BackgroundProcessInfo,
  killBackgroundProcess,
  listBackgroundProcesses,
  markBackgroundProcessesReported,
  readBackgroundProcess,
  sessionPrograms,
} from "../background-processes";
import { jobOwning, readProcessTable } from "../own-processes";
import {
  processExists,
  programGroup,
  terminateProcess,
} from "../subprocess-tree";
import { interruptibleWait } from "../wait-interrupts";
import {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
  MAX_RUNNING_AGE_MS,
  MAX_WAIT_MS,
} from "./background-job-commands";

export {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "./background-job-commands";

/**
 * Held back from the enclosing call's yield window so `fg` returns inside it.
 * Waiting right up to the edge is a race the wait loses: the call yields, and
 * the answer becomes a second process id instead of the output asked for.
 */
const YIELD_MARGIN_MS = 500;

/** What the job commands need from the `bash` call they are running inside. */
export interface SessionCommandContext {
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
  /** Owns the processes these commands can see, list and stop. */
  sessionId: StoreId.Session;
}

/**
 * The first argument of an `fg` that was typed as `wait`, which the shell's
 * rewrite puts there (`create-bash-env.ts`), so it answers as `wait`.
 */
export const WAIT_MARKER = "--called-as-wait";

/** The job that started the program with this pid, if one of the session's did. */
function jobStarting(
  pid: number,
  sessionId: StoreId.Session,
): string | undefined {
  return sessionPrograms(sessionId).find(
    (job) => job.running.has(pid) || job.ended.has(pid),
  )?.id;
}

export function createFgCommand({
  remainingYieldMs,
  sessionId,
}: SessionCommandContext) {
  return defineCommand(FG_COMMAND.name, async (given, ctx) => {
    // `wait` runs this under its own name, and says so in what it prints.
    const called = given[0] === WAIT_MARKER ? "wait" : FG_COMMAND.name;
    const args = given[0] === WAIT_MARKER ? given.slice(1) : given;
    const { ids, timeoutMs: requested } = parseFgArgs(args);
    if (requested === "invalid") {
      return fail(called, "--timeout takes a number of milliseconds.");
    }
    // The wait lives inside a tool call that yields on its own schedule, and a
    // wait that outlasts it gets the whole call promoted: the agent asked to
    // look at bg_1 and is handed bg_2, blocked on bg_1, answering nothing. So
    // the window is the ceiling, and an explicit --timeout can only lower it.
    const budget = Math.max(
      0,
      Math.min(MAX_WAIT_MS, remainingYieldMs() - YIELD_MARGIN_MS),
    );
    const timeoutMs =
      requested === undefined ? budget : Math.min(requested, budget);

    const targets =
      ids.length > 0
        ? ids
        : listBackgroundProcesses(sessionId)
            .filter((process) => process.status === "running")
            .map((process) => process.id);
    if (targets.length === 0) {
      return ok("No background processes to wait for.\n");
    }

    const sections: string[] = [];
    let failed = false;
    // The exit code is the last one foregrounded, which is what a shell's `fg`
    // reports and what makes `fg bg_1 && ...` mean what it looks like.
    let exitCode = 0;
    // A message for this session ends the wait: it is heard at the next step,
    // and a step spent waiting would hold it for the whole window.
    const interrupt = interruptibleWait(sessionId);
    try {
      for (const argument of targets) {
        const id =
          normalizeId(argument) ??
          (/^\d+$/.test(argument)
            ? jobStarting(Number(argument), sessionId)
            : undefined);
        const read = id
          ? await readBackgroundProcess({
              id,
              sessionId,
              signal: ctx.signal
                ? AbortSignal.any([ctx.signal, interrupt.signal])
                : interrupt.signal,
              waitMs: timeoutMs,
            })
          : undefined;
        if (!read) {
          failed = true;
          sections.push(
            /^\d+$/.test(argument)
              ? `${called}: pid ${argument} is not a background process this conversation started. \`${JOBS_COMMAND.name} -l\` lists them.`
              : `${called}: no background process "${argument}".`,
          );
          continue;
        }
        sections.push(formatRead(read));
        exitCode = foregroundExitCode(read.info);
        if (interrupt.signal.aborted) {
          break;
        }
      }
    } finally {
      interrupt.release();
    }
    if (interrupt.signal.aborted) {
      sections.push(
        "[A message arrived for you, so this wait ended early; it follows this result. The process is still running.]",
      );
    }

    const text = `${sections.join("\n\n")}\n`;
    return failed
      ? { exitCode: 1, stderr: text, stdout: "" }
      : { exitCode, stderr: "", stdout: text };
  });
}

export function createJobsCommand({ sessionId }: SessionCommandContext) {
  // Wrapped rather than declared `async`: listing is synchronous, and an async
  // function with nothing to await advertises a suspension that never happens.
  return defineCommand(JOBS_COMMAND.name, (args) =>
    Promise.resolve(listJobs(args, sessionId)),
  );
}

export function createKillCommand({ sessionId }: SessionCommandContext) {
  return defineCommand(KILL_COMMAND.name, async (args) => {
    const parsed = parseKillArgs(args);
    if ("error" in parsed) {
      return fail(KILL_COMMAND.name, parsed.error);
    }
    if ("list" in parsed) {
      return listSignals(parsed.list);
    }
    if (parsed.targets.length === 0) {
      return fail(
        KILL_COMMAND.name,
        `no process given. \`${JOBS_COMMAND.name} -l\` lists what you can stop.`,
      );
    }

    const out: string[] = [];
    const errors: string[] = [];
    // Read once, and only for a pid: listing every process costs a `ps`.
    let table:
      | Promise<Awaited<ReturnType<typeof readProcessTable>>>
      | undefined;
    for (const argument of parsed.targets) {
      const id = normalizeId(argument);
      const pid = /^\d+$/.test(argument) ? Number(argument) : undefined;
      if (id) {
        const line = await signalJob({ id, sessionId, signal: parsed.signal });
        (line.failed ? errors : out).push(...line.text);
      } else if (pid !== undefined && pid > 0) {
        table ??= readProcessTable();
        const line = await signalPid({
          pid,
          sessionId,
          signal: parsed.signal,
          table: await table,
        });
        (line.failed ? errors : out).push(...line.text);
      } else {
        errors.push(
          `${KILL_COMMAND.name}: ${argument}: arguments must be process ids or job ids (bg_1, %1).`,
        );
      }
    }

    return {
      exitCode: errors.length > 0 ? 1 : 0,
      stderr: errors.length > 0 ? `${errors.join("\n")}\n` : "",
      stdout: out.length > 0 ? `${out.join("\n")}\n` : "",
    };
  });
}

/**
 * What `kill` stops a process with: anything else a shell user would type to
 * end one. Each of them gets the stop that escalates and waits until the
 * process is really gone, since reporting a port free while it is not is
 * worse than taking a second longer. Any other signal goes straight through.
 */
const STOP_SIGNALS: ReadonlySet<string> = new Set(["INT", "KILL", "TERM"]);

/** Names a signal has besides its own, left out of `kill -l`. */
const SIGNAL_ALIASES: ReadonlySet<string> = new Set([
  "CLD",
  "IOT",
  "POLL",
  "UNUSED",
]);

/** The signals this computer has, by number, without aliases. */
function signalTable(): Map<number, string> {
  const table = new Map<number, string>();
  for (const [name, number] of Object.entries(os.constants.signals)) {
    const short = name.replace(/^SIG/, "");
    if (!SIGNAL_ALIASES.has(short) && !table.has(number)) {
      table.set(number, short);
    }
  }
  return new Map([...table].toSorted(([a], [b]) => a - b));
}

/** A signal as a shell user spells it (`9`, `KILL`, `SIGKILL`, `kill`). */
function signalName(spelled: string): string | undefined {
  if (/^\d+$/.test(spelled)) {
    const number = Number(spelled);
    return number === 0 ? "0" : signalTable().get(number);
  }
  const name = spelled.toUpperCase().replace(/^SIG/, "");
  return [...signalTable().values()].includes(name) ? name : undefined;
}

/** A signal's number on this computer, from its name; 0 for `0`. */
function signalNumber(name: string): number {
  for (const [number, each] of signalTable()) {
    if (each === name) {
      return number;
    }
  }
  return 0;
}

function parseKillArgs(
  args: string[],
):
  | { error: string }
  | { list: string[] }
  | { signal: string; targets: string[] } {
  let signal = "TERM";
  const targets: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (argument === "--") {
      targets.push(...args.slice(index + 1));
      break;
    }
    if (argument === "-l" || argument === "-L") {
      return { list: args.slice(index + 1) };
    }
    if (argument === "-s" || argument === "-n") {
      const value = args[++index] ?? "";
      const name = signalName(value);
      if (!name) {
        return { error: `${value}: invalid signal specification` };
      }
      signal = name;
      continue;
    }
    if (argument.startsWith("-") && targets.length === 0) {
      const name = signalName(argument.slice(1));
      if (!name) {
        return { error: `${argument.slice(1)}: invalid signal specification` };
      }
      signal = name;
      continue;
    }
    targets.push(argument);
  }
  return { signal, targets };
}

/** `kill -l`, as bash prints it: every signal, or each one asked about. */
function listSignals(asked: string[]) {
  const table = signalTable();
  if (asked.length > 0) {
    const lines: string[] = [];
    for (const each of asked) {
      const name = signalName(each);
      if (!name || name === "0") {
        return fail(KILL_COMMAND.name, `${each}: invalid signal specification`);
      }
      lines.push(/^\d+$/.test(each) ? name : String(signalNumber(name)));
    }
    return ok(`${lines.join("\n")}\n`);
  }
  const cells = [...table].map(
    ([number, name]) => `${String(number).padStart(2)}) SIG${name}`,
  );
  const rows: string[] = [];
  for (let at = 0; at < cells.length; at += 5) {
    rows.push(cells.slice(at, at + 5).join("\t"));
  }
  return ok(`${rows.join("\n")}\n`);
}

/** What one target of `kill` printed, and whether it failed. */
interface KillLine {
  failed: boolean;
  text: string[];
}

async function signalJob({
  id,
  sessionId,
  signal,
}: {
  id: string;
  sessionId: StoreId.Session;
  signal: string;
}): Promise<KillLine> {
  if (STOP_SIGNALS.has(signal)) {
    return await stopJob({ id, sessionId });
  }
  const info = listBackgroundProcesses(sessionId).find(
    (process) => process.id === id,
  );
  if (!info) {
    return {
      failed: true,
      text: [`${KILL_COMMAND.name}: no background process "${id}".`],
    };
  }
  if (info.status !== "running") {
    return {
      failed: true,
      text: [`${KILL_COMMAND.name}: ${id} is no longer running.`],
    };
  }
  if (signal === "0") {
    return { failed: false, text: [] };
  }
  if (info.pids.length === 0) {
    return {
      failed: true,
      text: [
        `${KILL_COMMAND.name}: ${id} has no program running to send SIG${signal} to.`,
      ],
    };
  }
  // To the whole job, the way a shell signals `%1`: each program it started
  // leads its own process group on macOS and Linux.
  const errors = info.pids.flatMap((pid) =>
    sendSignal(process.platform === "win32" ? pid : -programGroup(pid), signal),
  );
  return errors.length > 0
    ? {
        failed: true,
        text: errors.map((error) => `${KILL_COMMAND.name}: ${id}: ${error}`),
      }
    : { failed: false, text: [] };
}

async function stopJob({
  id,
  pid,
  sessionId,
}: {
  id: string;
  pid?: number;
  sessionId: StoreId.Session;
}): Promise<KillLine> {
  const killed = await killBackgroundProcess({ by: "agent", id, sessionId });
  if (!killed) {
    return {
      failed: true,
      text: [`${KILL_COMMAND.name}: no background process "${id}".`],
    };
  }
  const name = pid === undefined ? id : `${pid} (${id})`;
  const after = ms(killed.info.durationMs, { long: true });
  return {
    failed: false,
    text: [
      killed.terminationConfirmed
        ? killed.stoppedByThisCall
          ? `Stopped ${name} (\`${killed.info.command}\`) after ${after}.`
          : `${name} (\`${killed.info.command}\`) had already finished.`
        : `Could not confirm ${name} (\`${killed.info.command}\`) stopped after ${after}; it may still be running.`,
    ],
  };
}

async function signalPid({
  pid,
  sessionId,
  signal,
  table,
}: {
  pid: number;
  sessionId: StoreId.Session;
  signal: string;
  table: Awaited<ReturnType<typeof readProcessTable>>;
}): Promise<KillLine> {
  const exists = table ? table.has(pid) : processExists(pid);
  if (!exists) {
    return {
      failed: true,
      text: [`${KILL_COMMAND.name}: (${pid}) - No such process`],
    };
  }
  // Whether a process is there is a question about the computer, not a step
  // that changes it, so it is answered for any pid.
  if (signal === "0") {
    return { failed: false, text: [] };
  }
  const owner = jobOwning(pid, sessionPrograms(sessionId), table);
  if (!owner) {
    return { failed: true, text: [notOwnProcess(pid)] };
  }
  if (!STOP_SIGNALS.has(signal)) {
    // A program bubblewrap holds is reached through its sandbox's group.
    const group = programGroup(pid);
    const errors = sendSignal(group === pid ? pid : -group, signal);
    return errors.length > 0
      ? {
          failed: true,
          text: errors.map(
            (error) => `${KILL_COMMAND.name}: (${pid}) - ${error}`,
          ),
        }
      : { failed: false, text: [] };
  }
  const job =
    owner.id === undefined
      ? undefined
      : listBackgroundProcesses(sessionId).find(
          (process) => process.id === owner.id,
        );
  // The program a job is running stops the job, so `jobs` says so too.
  if (job?.status === "running" && job.pids.includes(pid)) {
    return await stopJob({ id: job.id, pid, sessionId });
  }
  const name = job ? `${pid} (in ${job.id})` : String(pid);
  return (await terminateProcess(pid))
    ? { failed: false, text: [`Stopped ${name}.`] }
    : {
        failed: false,
        text: [`Could not confirm ${name} stopped; it may still be running.`],
      };
}

/** The refusal for a pid outside this conversation's own processes. */
function notOwnProcess(pid: number): string {
  return `${KILL_COMMAND.name}: ${pid} is not a process this conversation started, so it can't be stopped from here. \`${JOBS_COMMAND.name} -l\` lists the ones you can stop.`;
}

/** Sends a signal, returning why it could not be sent, if it could not. */
function sendSignal(pid: number, signal: string): string[] {
  try {
    process.kill(pid, signalNumber(signal));
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function describeStatus(process: BackgroundProcessInfo) {
  if (process.status === "running") {
    return "running";
  }
  if (process.status === "termination-uncertain") {
    return "stopping?";
  }
  // Spelled out rather than left as the bare status, because the one-word form
  // reads like the command timed out on its own rather than like a cap nobody
  // asked for stopping a process that was working.
  if (process.status === "expired") {
    return `stopped (${ms(MAX_RUNNING_AGE_MS)} cap)`;
  }
  // No code for a kill. The number a killed process carries is the interpreter's
  // abort code rather than anything the command chose, so printing it invites
  // the reader to diagnose an exit that never happened.
  if (process.status === "killed") {
    return `stopped by ${stopper(process.stoppedBy)}`;
  }
  return process.exitCode === undefined
    ? process.status
    : `${process.status} (${process.exitCode})`;
}

function fail(command: string, message: string) {
  return { exitCode: 1, stderr: `${command}: ${message}\n`, stdout: "" };
}

/**
 * What `fg` exits with, which is what decides whether `fg bg_1 && ...` runs.
 *
 * Still running is not a failure: it is the answer a snapshot asked for, and
 * reporting it as one would color an ordinary poll as an error. Ending without
 * an exit code is, though. A process that was killed, that hit the age cap, or
 * that never confirmed it stopped never ran to completion, so reporting success
 * would run the chained command against work that was cut short -- and the text
 * printed directly above it says so in words.
 */
function foregroundExitCode(info: BackgroundProcessInfo): number {
  if (info.status === "running") {
    return 0;
  }
  return info.exitCode ?? 1;
}

function formatRead(read: {
  info: BackgroundProcessInfo;
  omittedBytes: number;
  output: string;
}) {
  const elapsed = ms(Math.max(1000, read.info.durationMs), { long: true });
  const header =
    read.info.status === "running"
      ? `${read.info.id} is still running (${elapsed} so far).`
      : read.info.status === "termination-uncertain"
        ? `${read.info.id} did not confirm termination after ${elapsed}; it may still be running.`
        : read.info.status === "expired"
          ? `${read.info.id} was stopped after ${elapsed} because a background process may run for at most ${ms(MAX_RUNNING_AGE_MS, { long: true })}. Nobody asked for it to stop and it did not fail; start it again if the work still needs it.`
          : // Before the exit code: a stopped process carries the interpreter's
            // abort code, and "finished with exit code 124" reads as the command
            // failing on its own when somebody ended it.
            read.info.status === "killed"
            ? `${read.info.id} was stopped by ${stopper(read.info.stoppedBy)} after ${elapsed}; it did not finish.${read.info.stoppedBy === "agent" ? "" : " Do not start it again unless asked to."}`
            : read.info.exitCode === undefined
              ? `${read.info.id} is no longer running (${read.info.status}) after ${elapsed}.`
              : `${read.info.id} finished with exit code ${read.info.exitCode} after ${elapsed}.`;

  const notices: string[] = [];
  if (read.omittedBytes > 0) {
    notices.push(
      `[${read.omittedBytes} bytes of earlier output were dropped because output outpaced your reads; see ${read.info.logFilePath}]`,
    );
  }
  if (read.info.logWriteError) {
    notices.push(
      `[The process log could not be written: ${read.info.logWriteError}]`,
    );
  }
  if (read.info.logOmittedBytes > 0) {
    notices.push(
      `[The bounded process log omitted ${read.info.logOmittedBytes} bytes.]`,
    );
  }

  const body = read.output
    ? [...notices, read.output.replace(/\n+$/, "")].join("\n")
    : [
        ...notices,
        read.info.status === "running"
          ? "No new output since your last read."
          : `No further output. Process log: ${read.info.logFilePath}`,
      ].join("\n");

  return `${header}\n\n${body}`;
}

function listJobs(args: string[], sessionId: StoreId.Session) {
  const processes = listBackgroundProcesses(sessionId);
  // The listing says how each one ended, so none of them wakes the session.
  markBackgroundProcessesReported(
    sessionId,
    processes
      .filter((process) => process.status !== "running")
      .map((process) => process.id),
  );

  if (args.includes("--json")) {
    return ok(`${JSON.stringify(processes.map(toJson), null, 2)}\n`);
  }
  const flags = new Set(
    args.filter((arg) => /^-[a-z]+$/.test(arg)).flatMap((arg) => arg.slice(1)),
  );
  // Only the pids, one a line, as a shell's `jobs -p` prints them.
  if (flags.has("p")) {
    const pids = processes.flatMap((process) => process.pids);
    return ok(pids.length > 0 ? `${pids.join("\n")}\n` : "");
  }
  if (processes.length === 0) {
    return ok("No background processes.\n");
  }

  const rows = processes.map((process) => [
    process.id,
    ...(flags.has("l")
      ? [process.pids.length > 0 ? process.pids.join(",") : "-"]
      : []),
    describeStatus(process),
    ms(Math.max(1000, process.durationMs)),
    process.command,
  ]);
  // Padded per column so ids, pids, statuses and durations line up; the
  // command is last and so needs no width of its own.
  const last = (rows[0]?.length ?? 1) - 1;
  const widths = rows[0]
    ? rows[0].map((_, column) =>
        Math.max(...rows.map((row) => (row[column] ?? "").length)),
      )
    : [];

  return ok(
    `${rows
      .map((row) =>
        row
          .map((cell, column) =>
            column === last ? cell : cell.padEnd(widths[column] ?? 0),
          )
          .join("  "),
      )
      .join("\n")}\n`,
  );
}

/**
 * The id forms a shell user would reach for: our own `bg_1`, and `%1`, which is
 * how a real shell names its first job. A bare number is a pid, which `kill`
 * checks is one of the session's own before it reaches it.
 */
export function normalizeId(argument: string): string | undefined {
  if (/^bg_\d+$/.test(argument)) {
    return argument;
  }
  const jobNumber = /^%(\d+)$/.exec(argument)?.[1];
  return jobNumber === undefined ? undefined : `bg_${jobNumber}`;
}

function ok(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

function parseFgArgs(args: string[]) {
  const ids: string[] = [];
  // `undefined` means none was given, which is not the same as one that could
  // not be read: the first takes the call's remaining window, the second is an
  // error worth telling the agent about.
  let timeoutMs: "invalid" | number | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (argument === "--timeout") {
      timeoutMs = readTimeout(args[++index]);
      continue;
    }
    const inline = /^--timeout=(.*)$/.exec(argument);
    if (inline) {
      timeoutMs = readTimeout(inline[1]);
      continue;
    }
    if (!argument.startsWith("-")) {
      ids.push(argument);
    }
  }
  return { ids, timeoutMs };
}

function readTimeout(raw: string | undefined) {
  const value = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(value)
    ? Math.min(MAX_WAIT_MS, Math.max(0, value))
    : ("invalid" as const);
}

/** Who a stop is attributed to, in the agent's own terms. */
function stopper(stoppedBy: BackgroundProcessInfo["stoppedBy"]) {
  switch (stoppedBy) {
    case "agent": {
      return `your \`${KILL_COMMAND.name}\``;
    }
    case "conversation": {
      return "the assistant that started this task";
    }
    case "user": {
      return "the user";
    }
    default: {
      return "a stop nobody here asked for";
    }
  }
}

function toJson(process: BackgroundProcessInfo) {
  return {
    command: process.command,
    durationMs: process.durationMs,
    exitCode: process.exitCode,
    id: process.id,
    logFilePath: process.logFilePath,
    pids: process.pids,
    status: process.status,
  };
}
