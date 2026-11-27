import fs from "node:fs";

/**
 * The freeze watchdog: a worker thread that notices when the main process's
 * main thread stops getting back to its event loop, which is the app not
 * responding at all. Main adds one to a shared counter from a timer
 * (`watchMainThreadStalls`), and the worker looks at it every second. A
 * counter that has not moved for `FREEZE_AFTER_MS` while the worker's own
 * timer kept time is main stuck: a loop that never yields, or a synchronous
 * call that never returns. A worker check that came late was the whole
 * process held (the computer sleeping, the system napping the app), and that
 * time is not counted. The watchdog adds it up for main, which reads it as
 * `heldMs` (`@instrument-org/shared/process-holds`) to leave holds out of
 * what it measures. A late check is not a hold when main had already missed
 * the check before it as well: main is stuck, and the whole app is starved
 * besides (the system swapping hard), so main gets no further when the
 * process does run. That time counts toward the freeze as starved time.
 *
 * A freeze is written down from the worker, since main's own logger appends
 * from main's event loop and so writes nothing while main is stuck: one log
 * line when it starts, and a small marker beside the crash record that says
 * how long it has lasted and how hard the process was working. The marker is
 * taken away when main comes back, so a marker the next launch finds is a
 * session that ended frozen, reported as Instrument stopped responding.
 *
 * Everything here runs in the worker as well as in main, so it imports
 * nothing but Node.
 */

/** How often the worker looks at main's counter. */
const FREEZE_CHECK_MS = 1_000;

/** How long main goes without moving the counter before it is frozen. */
const FREEZE_AFTER_MS = 10_000;

/**
 * A check this long after the one before means the worker was held too, so
 * the time between is the whole process's: held, or starved when main was
 * already stuck.
 */
const HELD_AFTER_MS = 2 * FREEZE_CHECK_MS;

/** How many freezes the worker logs in a launch before holding the rest back. */
const MAX_LOGGED_FREEZES = 20;

/**
 * How often a freeze's marker is written again while it lasts: every few
 * seconds at first, when the length matters most, then once a minute.
 */
function markerEveryMs(frozenMs: number) {
  return frozenMs < 60_000 ? 5_000 : 60_000;
}

/** CPU time the whole process has used, in microseconds, as `process.cpuUsage()` gives it. */
type CpuTotals = { system: number; user: number };

/**
 * A freeze as the worker measured it: when main last moved the counter, how
 * long it has been stuck since (time the process was held left out), how much
 * of that the whole process was starved too, and the CPU the whole process
 * used meanwhile, in percent of one core. A loop shows near 100 user; a call
 * waiting on something shows near nothing.
 */
export type Freeze = {
  cpu: { system: number; user: number };
  frozenMs: number;
  startedAt: number;
  /** The part of `frozenMs` the worker's own checks came late, the whole process starved. */
  starvedMs: number;
};

/** What a check found worth acting on. */
export type FreezeCheck =
  /** Main has just been stuck long enough: log it and write the marker. */
  | { freeze: Freeze; kind: "frozen" }
  /** Main is still stuck and the marker is due to be written again. */
  | { freeze: Freeze; kind: "still" }
  /** Main moved the counter again after a freeze, which lasted this long. */
  | { freeze: Freeze; kind: "recovered" };

/**
 * The watchdog's decisions, apart from its timer, its clock and its files,
 * so they can be driven with made-up times. `at` is a monotonic clock in
 * milliseconds, `now` the wall clock, `beats` main's counter and `cpu` the
 * process's CPU totals, all read at one check.
 */
export function createFreezeWatch() {
  let last: { at: number; beats: number; moved: boolean } | undefined;
  let heldMs = 0;
  // When the counter last moved, as the worker saw it.
  let since = { cpu: { system: 0, user: 0 }, now: 0 };
  // Time since then from checks on time, and from late checks while main was
  // already stuck.
  let stuckMs = 0;
  let starvedMs = 0;
  let frozen: Freeze | undefined;
  let markedAtMs = 0;

  return {
    /** Total time between checks that came late, the whole process held. */
    heldMs: () => heldMs,
    check({
      at,
      beats,
      cpu,
      now,
    }: {
      at: number;
      beats: number;
      cpu: CpuTotals;
      now: number;
    }): FreezeCheck | undefined {
      const previous = last;
      const moved = !previous || beats !== previous.beats;
      last = { at, beats, moved };
      const gap = previous ? at - previous.at : 0;
      const late = gap > HELD_AFTER_MS;
      // Main missed the check before too, so it was stuck before the process
      // was: a check after waking, before main has beaten, is still a hold.
      const starved = late && !moved && previous?.moved === false;
      // Before the counter, since main may beat first after a hold.
      if (late && !starved) {
        heldMs += gap;
      }
      if (moved) {
        const ended = frozen;
        frozen = undefined;
        stuckMs = 0;
        starvedMs = 0;
        since = { cpu, now };
        return ended && { freeze: ended, kind: "recovered" };
      }
      if (starved) {
        starvedMs += gap;
      } else if (late) {
        return undefined;
      } else {
        stuckMs += gap;
      }
      const frozenMs = stuckMs + starvedMs;
      if (frozenMs < FREEZE_AFTER_MS) {
        return undefined;
      }
      const freeze: Freeze = {
        cpu: {
          system: percentOfCore(cpu.system - since.cpu.system, frozenMs),
          user: percentOfCore(cpu.user - since.cpu.user, frozenMs),
        },
        frozenMs: Math.round(frozenMs),
        starvedMs: Math.round(starvedMs),
        startedAt: since.now,
      };
      const started = !frozen;
      frozen = freeze;
      if (started) {
        markedAtMs = frozenMs;
        return { freeze, kind: "frozen" };
      }
      if (frozenMs - markedAtMs >= markerEveryMs(markedAtMs)) {
        markedAtMs = frozenMs;
        return { freeze, kind: "still" };
      }
      return undefined;
    },
  };
}

function percentOfCore(micros: number, ms: number) {
  return Math.max(0, Math.round(micros / 10 / ms));
}

/**
 * A freeze in words, for the log and a report: `42 s, CPU 99% user and 1%
 * system`, or `3000 s, 2820 s of it with the whole app starved, CPU …`.
 */
export function describeFreeze(
  freeze: Pick<Freeze, "cpu" | "frozenMs" | "starvedMs">,
) {
  const starvedS = Math.round(freeze.starvedMs / 1000);
  const starved =
    starvedS > 0 ? `, ${starvedS} s of it with the whole app starved` : "";
  return `${Math.round(freeze.frozenMs / 1000)} s${starved}, CPU ${freeze.cpu.user}% user and ${freeze.cpu.system}% system`;
}

/** The marker's name in userData, beside the crash record and the session marker. */
export const FREEZE_MARKER_FILE = "main-freeze.json";

/** The marker a freeze leaves while it lasts, naming the process it froze. */
export type FreezeMarker = Freeze & { pid: number; version: string };

/** The marker at `markerPath`, or none when it is missing or unreadable. */
export function readFreezeMarker(markerPath: string): FreezeMarker | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      "version" in parsed &&
      "startedAt" in parsed &&
      "frozenMs" in parsed &&
      "cpu" in parsed &&
      typeof parsed.pid === "number" &&
      typeof parsed.version === "string" &&
      typeof parsed.startedAt === "number" &&
      typeof parsed.frozenMs === "number" &&
      typeof parsed.cpu === "object" &&
      parsed.cpu !== null &&
      "user" in parsed.cpu &&
      "system" in parsed.cpu &&
      typeof parsed.cpu.user === "number" &&
      typeof parsed.cpu.system === "number"
    ) {
      return {
        cpu: { system: parsed.cpu.system, user: parsed.cpu.user },
        frozenMs: parsed.frozenMs,
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        // A marker from a build that counted no starved time has none.
        starvedMs:
          "starvedMs" in parsed && typeof parsed.starvedMs === "number"
            ? parsed.starvedMs
            : 0,
        version: parsed.version,
      };
    }
  } catch {
    // Missing, or cut short by a process ended mid-write.
  }
  return undefined;
}

/**
 * The file the worker appends its line to, in the format of the transport
 * writing it: the packaged build's `main.log` lines, or the development
 * log's JSON lines.
 */
export type FreezeLogFile = { format: "json" | "text"; path: string };

/** What main hands the worker. Every field crosses to the worker by copy, the counter by sharing. */
export type FreezeWatchdogData = {
  /** One `Int32Array` slot main adds one to from its timer. */
  beats: SharedArrayBuffer;
  /** One `BigInt64Array` slot the worker keeps the process's total held milliseconds in. */
  held: SharedArrayBuffer;
  logFile: FreezeLogFile | undefined;
  markerPath: string;
  pid: number;
  version: string;
};

/** The one message the worker sends main: a freeze that ended. */
export type FreezeRecovered = { recovered: Freeze };

/**
 * The worker's loop: checks main's counter every `FREEZE_CHECK_MS`, logs a
 * freeze and keeps its marker while it lasts, and on recovery takes the
 * marker away and tells main. Runs until the process ends.
 */
export function runFreezeWatchdog(
  data: FreezeWatchdogData,
  post: (message: FreezeRecovered) => void,
) {
  const beats = new Int32Array(data.beats);
  const held = new BigInt64Array(data.held);
  const watch = createFreezeWatch();
  let logged = 0;

  const mark = (freeze: Freeze) => {
    const marker: FreezeMarker = {
      ...freeze,
      pid: data.pid,
      version: data.version,
    };
    // Written whole, then put in place, so the next launch never reads half.
    const draft = `${data.markerPath}.${data.pid}.tmp`;
    try {
      fs.writeFileSync(draft, JSON.stringify(marker));
      fs.renameSync(draft, data.markerPath);
    } catch {
      // Nowhere to say so: main is stuck, and the log is a file too.
    }
  };

  setInterval(() => {
    const found = watch.check({
      at: performance.now(),
      beats: Atomics.load(beats, 0),
      cpu: process.cpuUsage(),
      now: Date.now(),
    });
    Atomics.store(held, 0, BigInt(Math.round(watch.heldMs())));
    if (!found) {
      return;
    }
    switch (found.kind) {
      case "frozen": {
        logged += 1;
        if (logged <= MAX_LOGGED_FREEZES) {
          appendLine(
            data.logFile,
            `Main thread frozen for ${describeFreeze(found.freeze)}, and counting`,
          );
        } else if (logged === MAX_LOGGED_FREEZES + 1) {
          appendLine(
            data.logFile,
            `Main thread froze ${MAX_LOGGED_FREEZES} times this launch; later freezes are left out of the log`,
          );
        }
        mark(found.freeze);
        return;
      }
      case "still": {
        mark(found.freeze);
        return;
      }
      case "recovered": {
        try {
          fs.rmSync(data.markerPath, { force: true });
        } catch {
          // The next launch finds it and sees this process ended cleanly.
        }
        post({ recovered: found.freeze });
        return;
      }
    }
  }, FREEZE_CHECK_MS);
}

/** Appends one warning in the log's own format, from whichever thread. */
function appendLine(logFile: FreezeLogFile | undefined, message: string) {
  if (!logFile) {
    return;
  }
  const time = new Date().toISOString();
  const line =
    logFile.format === "text"
      ? `[${time}] [warn] (mainThread) ${message}`
      : JSON.stringify({
          level: "warn",
          msg: message,
          scope: "mainThread",
          time,
        });
  try {
    fs.appendFileSync(logFile.path, `${line}\n`);
  } catch {
    // A full disk or a log folder gone: the marker still says it.
  }
}
