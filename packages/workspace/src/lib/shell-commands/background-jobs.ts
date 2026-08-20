import { defineCommand } from "just-bash";
import ms from "ms";

import { type StoreId } from "../../schemas/store-id";
import {
  type BackgroundProcessInfo,
  killBackgroundProcess,
  listBackgroundProcesses,
  readBackgroundProcess,
} from "../background-processes";
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

export function createFgCommand({
  remainingYieldMs,
  sessionId,
}: SessionCommandContext) {
  return defineCommand(FG_COMMAND.name, async (args, ctx) => {
    const { ids, timeoutMs: requested } = parseFgArgs(args);
    if (requested === "invalid") {
      return fail(FG_COMMAND.name, "--timeout takes a number of milliseconds.");
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
    for (const argument of targets) {
      const id = normalizeId(argument);
      const read = id
        ? await readBackgroundProcess({
            id,
            sessionId,
            signal: ctx.signal,
            waitMs: timeoutMs,
          })
        : undefined;
      if (!read) {
        failed = true;
        sections.push(
          `${FG_COMMAND.name}: no background process "${argument}".`,
        );
        continue;
      }
      sections.push(formatRead(read));
      exitCode = foregroundExitCode(read.info);
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
    // A signal flag is what a shell user would reach for and changes nothing
    // here, so it is accepted rather than made into an error to recover from.
    const ids = args.filter((argument) => !argument.startsWith("-"));
    if (ids.length === 0) {
      return fail(KILL_COMMAND.name, "no process id given. Try `jobs`.");
    }

    const lines: string[] = [];
    let failed = false;
    for (const argument of ids) {
      const id = normalizeId(argument);
      if (!id) {
        failed = true;
        lines.push(
          `${KILL_COMMAND.name}: "${argument}" is not a background process id. Only ids from \`jobs\` (e.g. bg_1) can be stopped.`,
        );
        continue;
      }
      const killed = await killBackgroundProcess({ id, sessionId });
      if (!killed) {
        failed = true;
        lines.push(`${KILL_COMMAND.name}: no background process "${id}".`);
        continue;
      }
      lines.push(
        killed.terminationConfirmed
          ? killed.stoppedByThisCall
            ? `Stopped ${id} (\`${killed.info.command}\`) after ${ms(killed.info.durationMs, { long: true })}.`
            : `${id} (\`${killed.info.command}\`) had already finished.`
          : `Could not confirm ${id} (\`${killed.info.command}\`) stopped after ${ms(killed.info.durationMs, { long: true })}; it may still be running.`,
      );
    }

    const text = `${lines.join("\n")}\n`;
    return failed
      ? { exitCode: 1, stderr: text, stdout: "" }
      : { exitCode: 0, stderr: "", stdout: text };
  });
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

  if (args.includes("--json")) {
    return ok(`${JSON.stringify(processes.map(toJson), null, 2)}\n`);
  }
  if (processes.length === 0) {
    return ok("No background processes.\n");
  }

  const rows = processes.map((process) => [
    process.id,
    describeStatus(process),
    ms(Math.max(1000, process.durationMs)),
    process.command,
  ]);
  // Padded per column so ids, statuses and durations line up; the command is
  // last and so needs no width of its own.
  const widths = [0, 1, 2].map((column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );

  return ok(
    `${rows
      .map((row) =>
        row
          .map((cell, column) =>
            column === 3 ? cell : cell.padEnd(widths[column] ?? 0),
          )
          .join("  "),
      )
      .join("\n")}\n`,
  );
}

/**
 * The id forms a shell user would reach for: our own `bg_1`, and `%1`, which is
 * how a real shell names its first job. A bare number is a host pid, which is
 * deliberately not addressable from here.
 */
function normalizeId(argument: string): string | undefined {
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

function toJson(process: BackgroundProcessInfo) {
  return {
    command: process.command,
    durationMs: process.durationMs,
    exitCode: process.exitCode,
    id: process.id,
    logFilePath: process.logFilePath,
    status: process.status,
  };
}
