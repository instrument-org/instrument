import { describe, expect, it } from "vitest";

import {
  attemptsAt,
  IDLE_RESTART,
  type IdleRestartFacts,
  type IdleRestartState,
  idleRestartTimings,
  nextAttempts,
  relaunchViewOf,
  stepIdleRestart,
} from "./idle-restart-policy";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = 1_000_000_000_000;

const IN_VIEW = { focused: false, fullScreen: false, shown: true };
const NO_WINDOW = { focused: false, fullScreen: false, shown: false };
const FRESH: IdleRestartState = {
  noWindowSince: undefined,
  quietSince: undefined,
};

// Nothing in the way, a window in view behind another app, the person at
// the computer, an update staged a moment ago.
function facts(overrides: Partial<IdleRestartFacts> = {}): IdleRestartFacts {
  return {
    attempts: 0,
    lastAutomaticRestartAt: undefined,
    now: T0,
    person: { awayMs: 0, lockedSince: undefined },
    update: { stagedSince: T0, type: "ready", version: "2.1.0" },
    windows: IN_VIEW,
    work: "idle",
    ...overrides,
  };
}

// Readings one after another, carrying the state along.
function run(readings: IdleRestartFacts[], state = FRESH) {
  let carried = state;
  return readings.map((reading) => {
    const step = stepIdleRestart({ facts: reading, state: carried });
    carried = step.state;
    return step.verdict;
  });
}

const kinds = (verdicts: ReturnType<typeof run>) =>
  verdicts.map((verdict) =>
    verdict.type === "wait" ? verdict.blocker : verdict.reason,
  );

describe("what holds a restart back", () => {
  // Each with the screen locked long enough, which would otherwise restart.
  const locked = { awayMs: 0, lockedSince: T0 - HOUR };
  it.each([
    ["no update", { update: { type: "none" } }, "no-update"],
    [
      "an update being checked or downloaded",
      { update: { type: "busy" } },
      "update-busy",
    ],
    ["two attempts at this update already", { attempts: 2 }, "attempts-used"],
    [
      "a restart less than an hour ago",
      { lastAutomaticRestartAt: T0 - 59 * MINUTE },
      "restarted-recently",
    ],
    ["work running", { work: "busy" }, "work-busy"],
    ["work that could not be counted", { work: "unknown" }, "work-unknown"],
    [
      "a focused window",
      { windows: { focused: true, fullScreen: false, shown: true } },
      "focused",
    ],
    [
      "a full-screen window",
      { windows: { focused: false, fullScreen: true, shown: true } },
      "full-screen",
    ],
  ] satisfies [string, Partial<IdleRestartFacts>, string][])(
    "%s",
    (_, overrides, blocker) => {
      const step = stepIdleRestart({
        facts: facts({ person: locked, ...overrides }),
        state: { noWindowSince: undefined, quietSince: T0 - DAY },
      });
      expect(step.verdict).toEqual({ blocker, type: "wait" });
      expect(step.state.quietSince).toBeUndefined();
    },
  );

  it("waits while the person is at the computer and nothing says otherwise", () => {
    expect(stepIdleRestart({ facts: facts(), state: FRESH }).verdict)
      .toMatchInlineSnapshot(`
      {
        "blocker": "in-use",
        "type": "wait",
      }
    `);
  });

  it("allows another restart an hour after the last", () => {
    expect(
      stepIdleRestart({
        facts: facts({
          lastAutomaticRestartAt: T0 - HOUR,
          person: { awayMs: 15 * MINUTE, lockedSince: undefined },
        }),
        state: FRESH,
      }).verdict,
    ).toEqual({ reason: "away", type: "restart" });
  });
});

describe("the person stepping away", () => {
  it.each([
    [59 * SECOND, "in-use"],
    [MINUTE, "locked"],
  ] as const)("a screen locked for %i ms reads %s", (lockedFor, expected) => {
    const verdict = stepIdleRestart({
      facts: facts({
        person: { awayMs: 0, lockedSince: T0 - lockedFor },
      }),
      state: FRESH,
    }).verdict;
    expect(kinds([verdict])).toEqual([expected]);
  });

  it.each([
    [14 * MINUTE, "in-use"],
    [15 * MINUTE, "away"],
  ] as const)("no input for %i ms reads %s", (awayMs, expected) => {
    const verdict = stepIdleRestart({
      facts: facts({ person: { awayMs, lockedSince: undefined } }),
      state: FRESH,
    }).verdict;
    expect(kinds([verdict])).toEqual([expected]);
  });

  it("restarts once no window has shown for five minutes", () => {
    expect(
      kinds(
        run([
          facts({ now: T0, windows: NO_WINDOW }),
          facts({ now: T0 + 4 * MINUTE, windows: NO_WINDOW }),
          facts({ now: T0 + 5 * MINUTE, windows: NO_WINDOW }),
        ]),
      ),
    ).toEqual(["in-use", "in-use", "no-window"]);
  });

  it("starts the five minutes over when a window comes back into view", () => {
    expect(
      kinds(
        run([
          facts({ now: T0, windows: NO_WINDOW }),
          facts({ now: T0 + 4 * MINUTE }),
          facts({ now: T0 + 5 * MINUTE, windows: NO_WINDOW }),
          facts({ now: T0 + 9 * MINUTE, windows: NO_WINDOW }),
          facts({ now: T0 + 10 * MINUTE, windows: NO_WINDOW }),
        ]),
      ),
    ).toEqual(["in-use", "in-use", "in-use", "in-use", "no-window"]);
  });

  it("names the first sign: the lock before the windows before the input", () => {
    expect(
      stepIdleRestart({
        facts: facts({
          person: { awayMs: HOUR, lockedSince: T0 - HOUR },
          windows: NO_WINDOW,
        }),
        state: { noWindowSince: T0 - HOUR, quietSince: undefined },
      }).verdict,
    ).toEqual({ reason: "locked", type: "restart" });
  });
});

describe("the backstop", () => {
  const waited = (days: number) =>
    ({
      stagedSince: T0 - days * DAY,
      type: "ready",
      version: "2.1.0",
    }) as const;

  it("restarts in view once the update has waited three days and nothing has run for ten minutes", () => {
    expect(
      kinds(
        run([
          facts({ now: T0, update: waited(3) }),
          facts({ now: T0 + 9 * MINUTE, update: waited(3) }),
          facts({ now: T0 + 10 * MINUTE, update: waited(3) }),
        ]),
      ),
    ).toEqual(["in-use", "in-use", "backstop"]);
  });

  it("waits while the update is newer than three days", () => {
    expect(
      kinds(
        run([
          facts({ now: T0, update: waited(2.9) }),
          facts({ now: T0 + HOUR, update: waited(2.9) }),
        ]),
      ),
    ).toEqual(["in-use", "in-use"]);
  });

  it("starts the ten minutes over when a window takes focus or work starts", () => {
    const update = waited(4);
    expect(
      kinds(
        run([
          facts({ now: T0, update }),
          facts({
            now: T0 + 5 * MINUTE,
            update,
            windows: { focused: true, fullScreen: false, shown: true },
          }),
          facts({ now: T0 + 6 * MINUTE, update }),
          facts({ now: T0 + 12 * MINUTE, update, work: "busy" }),
          facts({ now: T0 + 13 * MINUTE, update }),
          facts({ now: T0 + 22 * MINUTE, update }),
          facts({ now: T0 + 23 * MINUTE, update }),
        ]),
      ),
    ).toEqual([
      "in-use",
      "focused",
      "in-use",
      "work-busy",
      "in-use",
      "in-use",
      "backstop",
    ]);
  });
});

describe("the last look before the quit", () => {
  // The last look is one more reading, with the state the countdown left.
  const ready: IdleRestartState = {
    noWindowSince: T0 - 10 * MINUTE,
    quietSince: T0 - 10 * MINUTE,
  };

  it("restarts when nothing changed", () => {
    expect(
      stepIdleRestart({ facts: facts({ windows: NO_WINDOW }), state: ready })
        .verdict,
    ).toEqual({ reason: "no-window", type: "restart" });
  });

  it.each([
    ["work started", { work: "busy" }, "work-busy"],
    ["the agents could not be counted", { work: "unknown" }, "work-unknown"],
    [
      "a window took focus",
      { windows: { focused: true, fullScreen: false, shown: true } },
      "focused",
    ],
    ["a window came back into view", { windows: IN_VIEW }, "in-use"],
    [
      "the screen was unlocked",
      {
        person: { awayMs: 0, lockedSince: undefined },
        windows: IN_VIEW,
      },
      "in-use",
    ],
  ] satisfies [string, Partial<IdleRestartFacts>, string][])(
    "calls it off when %s",
    (_, overrides, blocker) => {
      expect(
        stepIdleRestart({
          facts: facts({ windows: NO_WINDOW, ...overrides }),
          state: ready,
        }).verdict,
      ).toEqual({ blocker, type: "wait" });
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
  it("turns minutes into seconds, three days into 30 s and the hour into a minute for a test run", () => {
    expect(idleRestartTimings({ fast: true })).toMatchInlineSnapshot(`
      {
        "backstopAfterMs": 30000,
        "backstopQuietMs": 10000,
        "checkTimeoutMs": 10000,
        "lockedMs": 1000,
        "maxAttempts": 2,
        "noWindowMs": 5000,
        "personAwayMs": 15000,
        "recheckMs": 1000,
        "relaunchFreshMs": 300000,
        "spacingMs": 60000,
      }
    `);
    expect(idleRestartTimings({ fast: false })).toBe(IDLE_RESTART);
  });
});
