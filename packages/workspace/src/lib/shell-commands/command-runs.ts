import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

/**
 * What answered one command name in a bash call, recorded where the code
 * decides it, so a session log says which implementation ran and under what
 * sandbox without reading it back out of the output. Identical runs are one
 * row with a count. Lookups (`type`, `command -v`) and what the interpreter
 * answers itself (`cd`, `echo`, `export`) are not runs.
 */
export const CommandRunSchema = z.object({
  /** As the shell dispatched it, after aliases. */
  name: z.string(),
  /**
   * `bundled`: a program the app ships (uutils, rg, git, python, uv, node,
   * pnpm, ffmpeg, agent-browser). `system`: the computer's own program a text
   * route runs (`diff`, `file`, `tar`, `ps`). `path`: a program found on the
   * computer's PATH. `builtin`: just-bash's TypeScript command. `instrument`:
   * the app's own command that is not a process (`instrument`, `du`, `which`,
   * `jobs`).
   */
  source: z.enum(["builtin", "bundled", "instrument", "path", "system"]),
  /** The program's path on this computer, when a process ran. */
  program: z.string().optional(),
  /**
   * What held that process: Seatbelt, bubblewrap or MXC; `none` where no
   * sandbox could (Windows without MXC, or the person let programs run
   * without one); `skipped` where the call was chosen to run outside it (a
   * uutils call the reviewed rules allow, a process listing, an app the
   * person allowed).
   */
  sandbox: z.enum(["bwrap", "mxc", "none", "seatbelt", "skipped"]).optional(),
  /** Why a builtin answered a name the app routes to a program. */
  reason: z
    .enum(["builtin-args", "no-bundled-program", "no-system-program"])
    .optional(),
  count: z.number(),
});

export type CommandRun = z.output<typeof CommandRunSchema>;

type RunKey = Omit<CommandRun, "count">;

/** Distinct rows one call keeps; a pathological script's further ones are dropped. */
export const MAX_COMMAND_RUN_ROWS = 64;

function keyOf(run: RunKey): string {
  return [run.name, run.source, run.program, run.sandbox, run.reason].join(
    "\0",
  );
}

/**
 * One bash call's runs: those recorded on this thread, and the bash worker's
 * as it last reported them.
 */
export class CommandRuns {
  private readonly local = new Map<string, CommandRun>();
  private remote: CommandRun[] = [];

  /** Told when a distinct row is first recorded, which a count never is. */
  constructor(private readonly onNewRow?: () => void) {}

  record(run: RunKey): void {
    const key = keyOf(run);
    const row = this.local.get(key);
    if (row) {
      row.count += 1;
      return;
    }
    if (this.local.size >= MAX_COMMAND_RUN_ROWS) {
      return;
    }
    this.local.set(key, { ...run, count: 1 });
    this.onNewRow?.();
  }

  /** The bash worker's rows for this call, replacing what it reported before. */
  setRemote(rows: CommandRun[]): void {
    this.remote = rows;
  }

  rows(): CommandRun[] {
    const merged = new Map<string, CommandRun>();
    for (const row of [...this.remote, ...this.local.values()]) {
      const key = keyOf(row);
      const seen = merged.get(key);
      if (seen) {
        seen.count += row.count;
      } else if (merged.size < MAX_COMMAND_RUN_ROWS) {
        merged.set(key, { ...row });
      }
    }
    return [...merged.values()];
  }
}

const runsStorage = new AsyncLocalStorage<CommandRuns>();

/** Runs a bash call with `runs` collecting what answered each command. */
export function withCommandRuns<T>(runs: CommandRuns, run: () => T): T {
  return runsStorage.run(runs, run);
}

/** The runs the calling bash call collects into, if any. */
export function currentCommandRuns(): CommandRuns | undefined {
  return runsStorage.getStore();
}

export function recordCommandRun(run: RunKey): void {
  runsStorage.getStore()?.record(run);
}

/** One of the app's commands, running. */
interface Dispatch {
  name: string;
  recorded: boolean;
  source: CommandRun["source"];
}

const dispatchStorage = new AsyncLocalStorage<Dispatch>();

/**
 * Runs one of the app's commands so what it records is filed under its name:
 * each process it starts is a row with the program and sandbox, and one that
 * started none is a row of its own when it returns.
 */
export async function runDispatched<T>(
  name: string,
  source: CommandRun["source"],
  run: () => Promise<T>,
): Promise<T> {
  const dispatch: Dispatch = { name, recorded: false, source };
  try {
    return await dispatchStorage.run(dispatch, run);
  } finally {
    if (!dispatch.recorded) {
      recordCommandRun({ name, source });
    }
  }
}

/** A process started for the running command, held as `sandbox` says. */
export function recordProgramStart(
  program: string,
  sandbox: NonNullable<CommandRun["sandbox"]>,
): void {
  const dispatch = dispatchStorage.getStore();
  if (!dispatch) {
    return;
  }
  dispatch.recorded = true;
  recordCommandRun({
    name: dispatch.name,
    program,
    sandbox,
    source: dispatch.source,
  });
}

/** The running command handed its call to the builtin it shadows. */
export function recordBuiltinAnswered(
  reason: NonNullable<CommandRun["reason"]>,
): void {
  const dispatch = dispatchStorage.getStore();
  if (!dispatch) {
    return;
  }
  dispatch.recorded = true;
  recordCommandRun({ name: dispatch.name, reason, source: "builtin" });
}
