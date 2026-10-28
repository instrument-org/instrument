import { describe, expect, it } from "vitest";

import {
  attemptsAt,
  confirmIdleRestart,
  IDLE_RESTART,
  type IdleRestartFacts,
  idleRestartTimings,
  nextAttempts,
  relaunchViewOf,
  stepIdleRestart,
} from "./idle-restart-policy";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = 1_000_000_000_000;

// Everything clear, every window hidden, an update staged a moment ago.
function facts(overrides: Partial<IdleRestartFacts> = {}): IdleRestartFacts {
  return {
    attempts: 0,
    lastAutomaticRestartAt: undefined,
    now: T0,
    person: { awayMs: 0, locked: false },
    update: { stagedSince: T0, type: "ready", version: "2.1.0" },
    windows: { focused: false, fullScreen: false, shown: false },
    work: "idle",
    ...overrides,
  };
}

// Readings of the facts one after another, carrying the countdown along.
function run(readings: IdleRestartFacts[]) {
  let quietSince: number | undefined;
  return readings.map((reading) => {
    const step = stepIdleRestart({ facts: reading, quietSince });
    quietSince = step.quietSince;
    return step.verdict;
  });
}

describe("what holds a restart back", () => {
  it.each([
    ["no update", { update: { type: "none" } }],
    ["an update being checked or downloaded", { update: { type: "busy" } }],
    ["two attempts at this update already", { attempts: 2 }],
    ["work running", { work: "busy" }],
    ["work that could not be counted", { work: "unknown" }],
    [
      "a focused window",
      { windows: { focused: true, fullScreen: false, shown: true } },
    ],
    [
      "a full-screen window",
      { windows: { focused: false, fullScreen: true, shown: true } },
    ],
  ] satisfies [string, Partial<IdleRestartFacts>][])("%s", (_, overrides) => {
    const later = facts({ ...overrides, now: T0 + HOUR });
    expect(stepIdleRestart({ facts: later, quietSince: T0 })).toMatchObject({
      quietSince: undefined,
      verdict: { type: "wait" },
    });
  });

  it("names each blocker, the update first", () => {
    expect(
      stepIdleRestart({
        facts: facts({
          update: { type: "none" },
          windows: { focused: true, fullScreen: true, shown: true },
          work: "unknown",
        }),
        quietSince: undefined,
      }).verdict,
    ).toMatchInlineSnapshot(`
      {
        "blocker": "no-update",
        "type": "wait",
      }
    `);
    expect(
      stepIdleRestart({
        facts: facts({
          windows: { focused: true, fullScreen: true, shown: true },
          work: "unknown",
        }),
        quietSince: undefined,
      }).verdict,
    ).toMatchInlineSnapshot(`
      {
        "blocker": "work-unknown",
        "type": "wait",
      }
    `);
  });
});

describe("the countdown", () => {
  it("restarts once everything has been clear for ten minutes", () => {
    expect(
      run([
        facts({ now: T0 }),
        facts({ now: T0 + 9 * MINUTE }),
        facts({ now: T0 + 10 * MINUTE }),
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "readyAt": 1000000600000,
          "type": "settling",
        },
        {
          "readyAt": 1000000600000,
          "type": "settling",
        },
        {
          "tier": "unseen",
          "type": "restart",
        },
      ]
    `);
  });

  it("starts over when a window takes focus", () => {
    const focused = { focused: true, fullScreen: false, shown: true };
    const verdicts = run([
      facts({ now: T0 }),
      facts({ now: T0 + 9 * MINUTE, windows: focused }),
      facts({ now: T0 + 10 * MINUTE }),
      facts({ now: T0 + 19 * MINUTE }),
      facts({ now: T0 + 20 * MINUTE }),
    ]);
    expect(verdicts.map((verdict) => verdict.type)).toEqual([
      "settling",
      "wait",
      "settling",
      "settling",
      "restart",
    ]);
  });

  it("starts over when work starts, and when an update supersedes the staged one", () => {
    const verdicts = run([
      facts({ now: T0 }),
      facts({ now: T0 + 5 * MINUTE, work: "busy" }),
      facts({ now: T0 + 6 * MINUTE }),
      facts({ now: T0 + 12 * MINUTE, update: { type: "busy" } }),
      facts({
        now: T0 + 13 * MINUTE,
        update: { stagedSince: T0, type: "ready", version: "2.2.0" },
      }),
      facts({
        now: T0 + 23 * MINUTE,
        update: { stagedSince: T0, type: "ready", version: "2.2.0" },
      }),
    ]);
    expect(verdicts.map((verdict) => verdict.type)).toEqual([
      "settling",
      "wait",
      "settling",
      "wait",
      "settling",
      "restart",
    ]);
  });
});

describe("restarting where the person would see it", () => {
  const inView = { focused: false, fullScreen: false, shown: true };
  const decide = (overrides: Partial<IdleRestartFacts>) =>
    stepIdleRestart({
      facts: facts({ windows: inView, ...overrides }),
      quietSince: T0 - 10 * MINUTE,
    }).verdict;

  it.each([
    ["the screen is locked", { person: { awayMs: 0, locked: true } }],
    [
      "the person has been away ten minutes",
      { person: { awayMs: 10 * MINUTE, locked: false } },
    ],
  ] satisfies [string, Partial<IdleRestartFacts>][])(
    "goes unseen when %s",
    (_, overrides) => {
      expect(decide(overrides)).toEqual({ tier: "unseen", type: "restart" });
    },
  );

  it("waits while the update is newer than a day", () => {
    expect(
      decide({
        now: T0,
        update: {
          stagedSince: T0 - 23 * HOUR,
          type: "ready",
          version: "2.1.0",
        },
      }),
    ).toEqual({ blocker: "in-view-update-recent", type: "wait" });
  });

  it("restarts in view once the update has waited a day", () => {
    expect(
      decide({
        update: {
          stagedSince: T0 - 24 * HOUR,
          type: "ready",
          version: "2.1.0",
        },
      }),
    ).toEqual({ tier: "seen", type: "restart" });
  });

  it("restarts in view at most once a day", () => {
    const update = {
      stagedSince: T0 - 48 * HOUR,
      type: "ready",
      version: "2.1.0",
    } as const;
    expect(decide({ lastAutomaticRestartAt: T0 - 23 * HOUR, update })).toEqual({
      blocker: "in-view-restarted-recently",
      type: "wait",
    });
    expect(decide({ lastAutomaticRestartAt: T0 - 24 * HOUR, update })).toEqual({
      tier: "seen",
      type: "restart",
    });
  });

  it("does not cap restarts no one sees", () => {
    expect(
      stepIdleRestart({
        facts: facts({ lastAutomaticRestartAt: T0 - MINUTE }),
        quietSince: T0 - 10 * MINUTE,
      }).verdict,
    ).toEqual({ tier: "unseen", type: "restart" });
  });
});

describe("the last look before the quit", () => {
  it("restarts when nothing changed, without a second countdown", () => {
    expect(confirmIdleRestart({ facts: facts() })).toEqual({
      tier: "unseen",
      type: "restart",
    });
  });

  it.each([
    ["work started", { work: "busy" }, "work-busy"],
    ["the agents could not be counted", { work: "unknown" }, "work-unknown"],
    [
      "a window took focus",
      { windows: { focused: true, fullScreen: false, shown: true } },
      "focused",
    ],
    [
      "the person came back to a window in view",
      { windows: { focused: false, fullScreen: false, shown: true } },
      "in-view-update-recent",
    ],
  ] satisfies [string, Partial<IdleRestartFacts>, string][])(
    "calls it off when %s",
    (_, overrides, blocker) => {
      expect(confirmIdleRestart({ facts: facts(overrides) })).toEqual({
        blocker,
        type: "wait",
      });
    },
  );
});

describe("attempts at one update", () => {
  it("counts attempts at one target from one running version", () => {
    const first = nextAttempts({
      attempts: undefined,
      current: "2.0.0",
      to: "2.1.0",
    });
    const second = nextAttempts({
      attempts: first,
      current: "2.0.0",
      to: "2.1.0",
    });
    expect(second).toEqual({ count: 2, from: "2.0.0", to: "2.1.0" });
    expect(
      attemptsAt({ attempts: second, current: "2.0.0", to: "2.1.0" }),
    ).toBe(IDLE_RESTART.maxAttempts);
  });

  it.each([
    ["a newer target", { current: "2.0.0", to: "2.2.0" }],
    ["a different running version", { current: "2.0.5", to: "2.1.0" }],
  ])("starts over for %s", (_, at) => {
    const attempts = { count: 2, from: "2.0.0", to: "2.1.0" };
    expect(attemptsAt({ attempts, ...at })).toBe(0);
    expect(nextAttempts({ attempts, ...at }).count).toBe(1);
  });
});

describe("coming back from a restart", () => {
  it.each([
    ["front", "darwin", "front"],
    ["minimized", "darwin", "minimized"],
    ["hidden", "darwin", "hidden"],
    ["hidden", "win32", "minimized"],
  ] as const)("comes back %s on %s as %s", (view, platform, expected) => {
    expect(
      relaunchViewOf({ marker: { at: T0, view }, now: T0 + MINUTE, platform }),
    ).toBe(expected);
  });

  it.each([
    ["no marker", undefined, T0],
    [
      "a marker older than five minutes",
      { at: T0, view: "hidden" },
      T0 + 6 * MINUTE,
    ],
    ["a marker from the future", { at: T0, view: "hidden" }, T0 - MINUTE],
  ] as const)("opens as usual with %s", (_, marker, now) => {
    expect(relaunchViewOf({ marker, now, platform: "darwin" })).toBeUndefined();
  });
});

describe("timings", () => {
  it("turns minutes into seconds for a fast development run", () => {
    expect(idleRestartTimings({ fast: true })).toMatchInlineSnapshot(`
      {
        "maxAttempts": 2,
        "personAwayMs": 10000,
        "quietMs": 10000,
        "recheckMs": 1000,
        "relaunchFreshMs": 300000,
        "seenAfterWaitingMs": 1440000,
        "seenSpacingMs": 1440000,
      }
    `);
    expect(idleRestartTimings({ fast: false })).toBe(IDLE_RESTART);
  });
});
