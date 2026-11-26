import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFreezeWatch,
  describeFreeze,
  FREEZE_MARKER_FILE,
  type FreezeRecovered,
  readFreezeMarker,
  runFreezeWatchdog,
} from "./main-thread-freezes";

const START = Date.parse("2026-11-14T12:00:00.000Z");

/**
 * Drives a watch the way the worker's timer does, one check a second unless
 * told otherwise, with main's counter, the process's CPU (microseconds of
 * user time) and both clocks under the test's control.
 */
function drive() {
  const watch = createFreezeWatch();
  let at = 0;
  let beats = 0;
  let user = 0;
  return {
    beat: () => {
      beats += 1;
    },
    /** One check `ms` after the last, the process using `cpu` of one core meanwhile. */
    check: (ms = 1_000, cpu = 0) => {
      at += ms;
      user += ms * 10 * cpu;
      return watch.check({
        at,
        beats,
        cpu: { system: 0, user },
        now: START + at,
      });
    },
    heldMs: () => watch.heldMs(),
  };
}

describe("createFreezeWatch", () => {
  it("calls main frozen once its counter stands still for ten seconds of checks on time", () => {
    const watch = drive();
    watch.check();
    const quiet = Array.from({ length: 9 }, () => watch.check(1_000, 100));

    expect(quiet).toEqual(Array.from({ length: 9 }, () => undefined));
    expect(watch.check(1_000, 100)).toEqual({
      freeze: {
        cpu: { system: 0, user: 100 },
        frozenMs: 10_000,
        startedAt: START + 1_000,
      },
      kind: "frozen",
    });
  });

  it("stays quiet while main keeps moving its counter", () => {
    const watch = drive();
    for (let second = 0; second < 60; second++) {
      watch.beat();
      expect(watch.check()).toBeUndefined();
    }
  });

  it("leaves out the time the whole process was held, its own checks late too", () => {
    const watch = drive();
    watch.check();
    for (let second = 0; second < 5; second++) {
      watch.check();
    }
    // The computer slept for an hour: no check ran, main's timer neither.
    expect(watch.check(3_600_000)).toBeUndefined();
    for (let second = 0; second < 4; second++) {
      expect(watch.check()).toBeUndefined();
    }

    expect(watch.check()).toMatchObject({
      freeze: { frozenMs: 10_000 },
      kind: "frozen",
    });
  });

  it("never calls a sleep a freeze when main beats right after waking", () => {
    const watch = drive();
    watch.check();
    watch.check(3_600_000);
    watch.beat();

    expect(watch.check()).toBeUndefined();
    for (let second = 0; second < 9; second++) {
      expect(watch.check()).toBeUndefined();
    }
  });

  it("adds up the time the process was held, whether main beat first or not", () => {
    const watch = drive();
    watch.check();
    watch.check(3_600_000);
    watch.check();
    watch.beat();
    watch.check(600_000);
    watch.check(1_500);

    expect(watch.heldMs()).toBe(4_200_000);
  });

  it("says how long a freeze lasted once main moves its counter again, then starts over", () => {
    const watch = drive();
    watch.check();
    for (let second = 0; second < 23; second++) {
      watch.check(1_000, 100);
    }
    watch.beat();

    expect(watch.check()).toEqual({
      freeze: {
        cpu: { system: 0, user: 100 },
        frozenMs: 23_000,
        startedAt: START + 1_000,
      },
      kind: "recovered",
    });
    expect(watch.check()).toBeUndefined();
  });

  it("tells a loop from a call waiting on something by the process's CPU", () => {
    const loop = drive();
    const waiting = drive();
    loop.check();
    waiting.check();
    for (let second = 0; second < 9; second++) {
      loop.check(1_000, 98);
      waiting.check(1_000, 2);
    }

    expect(loop.check(1_000, 98)?.freeze.cpu.user).toBe(98);
    expect(waiting.check(1_000, 2)?.freeze.cpu.user).toBe(2);
  });

  it("brings the marker up to date every five seconds, then once a minute", () => {
    const watch = drive();
    watch.check();
    const due: number[] = [];
    for (let second = 1; second <= 180; second++) {
      const found = watch.check();
      if (found) {
        due.push(found.freeze.frozenMs / 1000);
      }
    }

    expect(due).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 120, 180]);
  });
});

it("describes a freeze by its length and CPU", () => {
  expect(
    describeFreeze({ cpu: { system: 1, user: 99 }, frozenMs: 42_400 }),
  ).toBe("42 s, CPU 99% user and 1% system");
});

describe("runFreezeWatchdog", () => {
  let dir = "";

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("logs a freeze and keeps its marker from the worker, then clears it when main comes back", () => {
    vi.useFakeTimers({
      now: START,
      toFake: ["Date", "performance", "setInterval", "clearInterval"],
    });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freeze-watchdog-"));
    let user = 0;
    vi.spyOn(process, "cpuUsage").mockImplementation(() => {
      user = Date.now() - START;
      return { system: 0, user: user * 1000 };
    });
    const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const beats = new Int32Array(buffer);
    const markerPath = path.join(dir, FREEZE_MARKER_FILE);
    const logPath = path.join(dir, "main.log");
    const posted: FreezeRecovered[] = [];
    runFreezeWatchdog(
      {
        beats: buffer,
        held: new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT),
        logFile: { format: "text", path: logPath },
        markerPath,
        pid: 4242,
        version: "2.0.9",
      },
      (message) => posted.push(message),
    );

    vi.advanceTimersByTime(10_000);
    expect(fs.existsSync(markerPath)).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(fs.readFileSync(logPath, "utf8")).toBe(
      "[2026-11-14T12:00:11.000Z] [warn] (mainThread) Main thread frozen for 10 s, CPU 100% user and 0% system, and counting\n",
    );
    expect(readFreezeMarker(markerPath)).toEqual({
      cpu: { system: 0, user: 100 },
      frozenMs: 10_000,
      pid: 4242,
      startedAt: START + 1_000,
      version: "2.0.9",
    });

    vi.advanceTimersByTime(5_000);
    expect(readFreezeMarker(markerPath)?.frozenMs).toBe(15_000);
    // One line a freeze, however long it lasts.
    expect(fs.readFileSync(logPath, "utf8").split("\n")).toHaveLength(2);

    Atomics.add(beats, 0, 1);
    vi.advanceTimersByTime(1_000);
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(posted).toEqual([
      {
        recovered: {
          cpu: { system: 0, user: 100 },
          frozenMs: 15_000,
          startedAt: START + 1_000,
        },
      },
    ]);
  });

  it("writes the development log's JSON lines", () => {
    vi.useFakeTimers({
      now: START,
      toFake: ["Date", "performance", "setInterval", "clearInterval"],
    });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freeze-watchdog-"));
    vi.spyOn(process, "cpuUsage").mockReturnValue({ system: 0, user: 0 });
    const logPath = path.join(dir, "dev.jsonl");
    runFreezeWatchdog(
      {
        beats: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        held: new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT),
        logFile: { format: "json", path: logPath },
        markerPath: path.join(dir, FREEZE_MARKER_FILE),
        pid: 4242,
        version: "2.0.9",
      },
      () => {},
    );

    vi.advanceTimersByTime(11_000);
    expect(JSON.parse(fs.readFileSync(logPath, "utf8"))).toEqual({
      level: "warn",
      msg: "Main thread frozen for 10 s, CPU 0% user and 0% system, and counting",
      scope: "mainThread",
      time: "2026-11-14T12:00:11.000Z",
    });
  });
});
