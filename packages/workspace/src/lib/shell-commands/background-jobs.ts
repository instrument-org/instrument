import { defineCommand } from "just-bash";
import ms from "ms";
import { dedent } from "radashi";

import { type StoreId } from "../../schemas/store-id";
import {
  type BackgroundProcessInfo,
  killBackgroundProcess,
  listBackgroundProcesses,
  readBackgroundProcess,
} from "../background-processes";

/** What the job commands need from the `bash` call they are running inside. */
export interface SessionCommandContext {
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
  /** Owns the processes these commands can see, list and stop. */
  sessionId: StoreId.Session;
}

/** Ceiling on one `fg`, matching the longest a single tool call may run. */
const MAX_WAIT_MS = ms("10 minutes");

/**
 * Held back from the enclosing call's yield window so `fg` returns inside it.
 * Waiting right up to the edge is a race the wait loses: the call yields, and
 * the answer becomes a second process id instead of the output asked for.
 */
const YIELD_MARGIN_MS = 500;

export const JOBS_COMMAND = {
  description: dedent`
    List the background processes this session started, with their status, run time and command.
    Unlike the rest of the shell, this survives across calls: a process started by an earlier call is still listed here. Use it at the start of a turn to find what is already running instead of starting a second copy.
    Usage: \`jobs [--json]\`.
  `.trim(),
  name: "jobs",
} as const;

export const KILL_COMMAND = {
  description: dedent`
    Stop background processes started by \`bash\`, waiting until each has really exited.
    Usage: \`kill <id>...\`, where each id is one \`jobs\` reports (\`bg_1\`). A signal flag (\`-9\`) is accepted and ignored; termination always escalates on its own. Killing one that already finished is harmless.
    Only these ids can be stopped -- there is no access to the machine's own processes, so a bare number is refused.
  `.trim(),
  name: "kill",
} as const;

export const FG_COMMAND = {
  description: dedent`
    Bring a background process to the foreground: print what it has written since your last read, and block until it exits.
    Usage: \`fg [<id>...] [--timeout <ms>]\`. With no id it takes everything still running. Exits with the process's own exit code once it finishes, so \`fg bg_1 && pnpm test\` runs the tests only on success.
    \`--timeout 0\` returns immediately with whatever is pending, which is how you glance at a server that never exits. Otherwise it blocks until the process exits, so this is how you wait out a build in one call rather than polling.
    IMPORTANT: it never waits past this \`bash\` call's own \`yieldMs\`; it returns what has arrived by then instead. To wait out something longer, raise \`yieldMs\` on the \`bash\` call rather than the timeout here.
    IMPORTANT: reading consumes -- each call returns only what arrived since the last one, so piping into a filter (\`fg bg_1 | rg error\`) discards the rest. The complete output is always in the process's log file.
  `.trim(),
  name: "fg",
} as const;

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
      // Still running is not a failure: it is the answer a snapshot asked for,
      // and reporting it as one would color an ordinary poll as an error.
      exitCode = read.info.status === "running" ? 0 : (read.info.exitCode ?? 0);
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
  return process.exitCode === undefined
    ? process.status
    : `${process.status} (${process.exitCode})`;
}

function fail(command: string, message: string) {
  return { exitCode: 1, stderr: `${command}: ${message}\n`, stdout: "" };
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
