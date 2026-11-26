import { createAlarmGate } from "@instrument-org/shared/alarms";
import { expect, it, vi } from "vitest";

import { createLogVolumeMeter } from "./log-volume";

const KB = 1_000;
const MB = 1_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function setup() {
  let clock = 0;
  const now = () => clock;
  const warn = vi.fn<(line: string) => void>();
  const meter = createLogVolumeMeter({
    warn,
    now,
    gate: createAlarmGate({ now }),
  });
  return {
    meter,
    warn,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

it("warns once a scope writes more than a megabyte within an hour", () => {
  const { meter, warn, advance } = setup();
  for (let i = 0; i < 10; i++) {
    meter.wrote("chats", 100 * KB);
    advance(5 * MINUTE);
  }
  expect(warn).not.toHaveBeenCalled();
  meter.wrote("chats", 1);
  meter.wrote(undefined, 2 * MB);
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Log volume: chats wrote 1.0 MB to the log within an hour",
      ],
      [
        "Log volume: (none) wrote 2.0 MB to the log within an hour",
      ],
    ]
  `);
});

it("forgets what fell out of the rolling hour", () => {
  const { meter, warn, advance } = setup();
  const hourly = () =>
    warn.mock.calls.filter(([line]) => line.includes("within an hour"));
  for (let i = 0; i < 24; i++) {
    meter.wrote("chats", 200 * KB);
    advance(15 * MINUTE);
  }
  expect(hourly()).toEqual([]);
  meter.wrote("chats", 600 * KB);
  advance(50 * MINUTE);
  meter.wrote("chats", 500 * KB);
  expect(hourly()).toHaveLength(1);
});

it("warns once a scope writes more than a megabyte within a day, however slowly", () => {
  const { meter, warn, advance } = setup();
  // The 1Password worker's console on a MacBook: about 40 KB an hour.
  for (let hour = 0; hour < 24; hour++) {
    advance(hour === 0 ? 0 : HOUR);
    meter.wrote("BrowserViewManager", 41 * KB);
  }
  expect(warn).not.toHaveBeenCalled();
  meter.wrote("BrowserViewManager", 20 * KB);
  // Once a day, not once an hour.
  for (let hour = 0; hour < 23; hour++) {
    advance(HOUR);
    meter.wrote("BrowserViewManager", 42 * KB);
  }
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Log volume: BrowserViewManager wrote 1.0 MB to the log within a day",
      ],
    ]
  `);
  // Again once the day after the warning has passed, the drip still running.
  for (let hour = 0; hour < 2; hour++) {
    advance(HOUR);
    meter.wrote("BrowserViewManager", 42 * KB);
  }
  expect(warn).toHaveBeenCalledTimes(2);
});

it("forgets what fell out of the rolling day", () => {
  const { meter, warn, advance } = setup();
  for (let hour = 0; hour < 48; hour++) {
    meter.wrote("chats", (hour < 24 ? 30 : 15) * KB);
    advance(HOUR);
  }
  meter.wrote("chats", 600 * KB);
  expect(warn).not.toHaveBeenCalled();
});

it("warns once the whole log takes more than 4 MB within an hour, naming the scopes writing most", () => {
  const { meter, warn } = setup();
  const written = {
    rpc: 0.9,
    chats: 0.8,
    browser: 0.7,
    updater: 0.6,
    files: 0.5,
    auth: 0.5,
  };
  for (const [scope, megabytes] of Object.entries(written)) {
    meter.wrote(scope, megabytes * MB);
  }
  expect(warn).not.toHaveBeenCalled();
  meter.wrote("auth", 1);
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Log volume: the log took 4.0 MB within an hour (most: rpc 0.9 MB, chats 0.8 MB, browser 0.7 MB)",
      ],
    ]
  `);
});

it("warns at most once an hour per scope", () => {
  const { meter, warn, advance } = setup();
  meter.wrote("chats", 2 * MB);
  advance(HOUR - 1);
  meter.wrote("chats", 2 * MB);
  expect(warn).toHaveBeenCalledTimes(1);
  advance(1);
  meter.wrote("chats", 2 * MB);
  expect(warn).toHaveBeenCalledTimes(2);
});

it("leaves its own warning out of the count, so it cannot raise another", () => {
  const lines: string[] = [];
  const meter = createLogVolumeMeter({
    warn: (line) => {
      lines.push(line);
      // The transport hands the warning straight back to the meter.
      meter.wrote("log", 10 * MB);
    },
    now: () => 0,
    gate: createAlarmGate({ now: () => 0 }),
  });
  meter.wrote("chats", 2 * MB);
  meter.wrote("log", 1);
  expect(lines).toEqual([
    "Log volume: chats wrote 2.0 MB to the log within an hour",
  ]);
});

it("counts scopes past two hundred under one name", () => {
  const { meter, warn } = setup();
  for (let i = 0; i < 200; i++) {
    meter.wrote(`scope-${i}`, 1);
  }
  meter.wrote("one-more", 0.6 * MB);
  meter.wrote("and-another", 0.6 * MB);
  expect(warn.mock.calls[0]?.[0]).toMatch(
    /^Log volume: \(other\) wrote 1\.2 MB/,
  );
});

it("never throws into the logger when the warning or the clock does", () => {
  const throwing = createLogVolumeMeter({
    warn: () => {
      throw new Error("log broke");
    },
    gate: createAlarmGate(),
  });
  expect(() => {
    throwing.wrote("chats", 2 * MB);
  }).not.toThrow();
  const broken = createLogVolumeMeter({
    warn: vi.fn(),
    now: () => {
      throw new Error("clock broke");
    },
  });
  expect(() => {
    broken.wrote("chats", 2 * MB);
  }).not.toThrow();
});
