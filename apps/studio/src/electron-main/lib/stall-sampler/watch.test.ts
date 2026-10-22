import { describe, expect, it } from "vitest";

import {
  BEAT_MS,
  createStallWatch,
  FIRST_REPORT_MS,
  formatStallLine,
} from "./watch";

/** Samples every BEAT_MS from 0 to `until`, returning the reports made. */
function run({
  beatAt,
  suspendedAt = () => false,
  until,
}: {
  beatAt: (now: number) => number;
  suspendedAt?: (now: number) => boolean;
  until: number;
}) {
  const watch = createStallWatch(0);
  const reports: { at: number; silent: number }[] = [];
  for (let now = 0; now <= until; now += BEAT_MS) {
    const silent = watch.sample({
      beat: beatAt(now),
      now,
      suspended: suspendedAt(now),
    });
    if (silent !== undefined) {
      reports.push({ at: now, silent });
    }
  }
  return reports;
}

describe("createStallWatch", () => {
  it("says nothing while main keeps beating", () => {
    expect(run({ beatAt: (now) => now, until: 10_000 })).toEqual([]);
  });

  it("reports a hang at the first threshold and then as it doubles", () => {
    // Main stops beating at 500ms and never comes back.
    const reports = run({
      beatAt: (now) => Math.min(now, 500),
      until: 10_000,
    });

    expect(reports).toMatchInlineSnapshot(`
      [
        {
          "at": 1500,
          "silent": 1000,
        },
        {
          "at": 2500,
          "silent": 2000,
        },
        {
          "at": 4500,
          "silent": 4000,
        },
        {
          "at": 8500,
          "silent": 8000,
        },
      ]
    `);
  });

  it("starts over after main answers", () => {
    // Two stalls, each a little over the first threshold.
    const stalled = (now: number) =>
      (now >= 1000 && now < 2500) || (now >= 5000 && now < 6500);
    const reports = run({
      beatAt: (now) => (stalled(now) ? -1 : now),
      until: 8000,
    });

    expect(reports.map((report) => report.silent)).toEqual([
      FIRST_REPORT_MS,
      FIRST_REPORT_MS,
    ]);
  });

  it("ignores silence while the computer is asleep", () => {
    expect(
      run({
        beatAt: () => 0,
        suspendedAt: () => true,
        until: 10_000,
      }),
    ).toEqual([]);
  });

  it("does not count a gap in its own samples as main's silence", () => {
    const watch = createStallWatch(0);
    watch.sample({ beat: 1, now: 0, suspended: false });

    expect(watch.sample({ beat: 1, now: 60_000, suspended: false })).toBe(
      undefined,
    );
    expect(
      watch.sample({ beat: 1, now: 60_000 + BEAT_MS, suspended: false }),
    ).toBe(undefined);
  });
});

describe("formatStallLine", () => {
  it("writes the dev log's NDJSON entry", () => {
    const line = formatStallLine({
      format: "jsonl",
      message: "Main thread has not answered for 1000ms",
      time: new Date("2026-10-21T12:00:00.000Z"),
    });

    expect(JSON.parse(line)).toEqual({
      level: "warn",
      msg: "Main thread has not answered for 1000ms",
      scope: "stallSampler",
      time: "2026-10-21T12:00:00.000Z",
    });
  });

  it("writes electron-log's text line", () => {
    const line = formatStallLine({
      format: "text",
      message: "Main thread has not answered for 1000ms",
      time: new Date(2026, 9, 21, 7, 5, 3, 9),
    });

    expect(line).toBe(
      "[2026-10-21 07:05:03.009] [warn] (stallSampler) Main thread has not answered for 1000ms\n",
    );
  });
});
