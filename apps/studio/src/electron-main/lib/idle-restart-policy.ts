import ms from "ms";

/**
 * When the app restarts on its own to apply a staged update. Every value is a
 * starting value, to be tuned once restarts are seen in use.
 */
export const IDLE_RESTART = {
  /** How long every blocker must stay clear before a restart. */
  quietMs: ms("10 minutes"),
  /** How long the person has been away from the computer for a restart to go unseen. */
  personAwayMs: ms("10 minutes"),
  /** How long an update has waited before a restart may happen in view. */
  seenAfterWaitingMs: ms("24 hours"),
  /** The least time between an automatic restart and one in view. */
  seenSpacingMs: ms("24 hours"),
  /** How often the facts are read again while an update waits. */
  recheckMs: ms("30 seconds"),
  /** Attempts at one target from one running version before giving up on it. */
  maxAttempts: 2,
  /** How old a relaunch marker may be and still mean this launch is the restart. */
  relaunchFreshMs: ms("5 minutes"),
} as const;

export type IdleRestartTimings = { [K in keyof typeof IDLE_RESTART]: number };

/** What the app and the computer look like right now. */
export type IdleRestartFacts = {
  now: number;
  update:
    | { type: "none" }
    // Being checked, downloaded over, or installed: try again shortly.
    | { type: "busy" }
    | { stagedSince: number; type: "ready"; version: string };
  /** Attempts already made at the staged version from the running one. */
  attempts: number;
  /** Agents, jobs and dictation; `unknown` when they could not be counted. */
  work: "busy" | "idle" | "unknown";
  windows: { focused: boolean; fullScreen: boolean; shown: boolean };
  person: { awayMs: number; locked: boolean };
  lastAutomaticRestartAt: number | undefined;
};

type IdleRestartBlocker =
  | "attempts-used"
  | "focused"
  | "full-screen"
  | "no-update"
  | "update-busy"
  | "work-busy"
  | "work-unknown"
  // A window is in view and the person is at the computer, and the update
  // has not waited long enough, or a restart happened too recently.
  | "in-view-update-recent"
  | "in-view-restarted-recently";

export type IdleRestartVerdict =
  | { blocker: IdleRestartBlocker; type: "wait" }
  | { readyAt: number; type: "settling" }
  | { tier: "seen" | "unseen"; type: "restart" };

function blockerOf(
  facts: IdleRestartFacts,
  timings: IdleRestartTimings,
): IdleRestartBlocker | undefined {
  if (facts.update.type === "none") {
    return "no-update";
  }
  if (facts.update.type === "busy") {
    return "update-busy";
  }
  if (facts.attempts >= timings.maxAttempts) {
    return "attempts-used";
  }
  if (facts.work !== "idle") {
    return facts.work === "busy" ? "work-busy" : "work-unknown";
  }
  if (facts.windows.focused) {
    return "focused";
  }
  if (facts.windows.fullScreen) {
    return "full-screen";
  }
  return undefined;
}

function tierOf(
  facts: IdleRestartFacts,
  timings: IdleRestartTimings,
): IdleRestartVerdict {
  const unseen =
    !facts.windows.shown ||
    facts.person.locked ||
    facts.person.awayMs >= timings.personAwayMs;
  if (unseen) {
    return { tier: "unseen", type: "restart" };
  }
  if (
    facts.update.type !== "ready" ||
    facts.now - facts.update.stagedSince < timings.seenAfterWaitingMs
  ) {
    return { blocker: "in-view-update-recent", type: "wait" };
  }
  if (
    facts.lastAutomaticRestartAt !== undefined &&
    facts.now - facts.lastAutomaticRestartAt < timings.seenSpacingMs
  ) {
    return { blocker: "in-view-restarted-recently", type: "wait" };
  }
  return { tier: "seen", type: "restart" };
}

/**
 * One reading of the facts: when every blocker has been clear since, and
 * what to do now. A blocker resets the countdown, so a window taking focus
 * starts the wait over.
 */
export function stepIdleRestart({
  facts,
  quietSince,
  timings = IDLE_RESTART,
}: {
  facts: IdleRestartFacts;
  quietSince: number | undefined;
  timings?: IdleRestartTimings;
}): { quietSince: number | undefined; verdict: IdleRestartVerdict } {
  const blocker = blockerOf(facts, timings);
  if (blocker) {
    return { quietSince: undefined, verdict: { blocker, type: "wait" } };
  }
  const since = quietSince ?? facts.now;
  if (facts.now - since < timings.quietMs) {
    return {
      quietSince: since,
      verdict: { readyAt: since + timings.quietMs, type: "settling" },
    };
  }
  return { quietSince: since, verdict: tierOf(facts, timings) };
}

/**
 * The last look before committing to the quit, with the countdown already
 * run: anything that started in the meantime calls the restart off.
 */
export function confirmIdleRestart({
  facts,
  timings = IDLE_RESTART,
}: {
  facts: IdleRestartFacts;
  timings?: IdleRestartTimings;
}): IdleRestartVerdict {
  const blocker = blockerOf(facts, timings);
  return blocker ? { blocker, type: "wait" } : tierOf(facts, timings);
}

export type RestartAttempts = { count: number; from: string; to: string };

/** Attempts already made at `to` from the running version. */
export function attemptsAt({
  attempts,
  current,
  to,
}: {
  attempts: RestartAttempts | undefined;
  current: string;
  to: string;
}) {
  return attempts?.to === to && attempts.from === current ? attempts.count : 0;
}

/** The record after one more attempt at `to` from `current`. */
export function nextAttempts({
  attempts,
  current,
  to,
}: {
  attempts: RestartAttempts | undefined;
  current: string;
  to: string;
}): RestartAttempts {
  return {
    count: attemptsAt({ attempts, current, to }) + 1,
    from: current,
    to,
  };
}

/** How the app window was left, for the restart to bring it back the same way. */
export type RelaunchView = "front" | "hidden" | "minimized";

/**
 * How a launch puts its window up, from the marker the restart before it
 * left: `undefined` for an ordinary launch. A marker that is old means this
 * launch is not the restart that wrote it. A window can be left hidden only
 * on macOS, where the Dock brings it back; elsewhere it comes back minimized,
 * so it can still be found.
 */
export function relaunchViewOf({
  marker,
  now,
  platform,
  timings = IDLE_RESTART,
}: {
  marker: { at: number; view: RelaunchView } | undefined;
  now: number;
  platform: NodeJS.Platform;
  timings?: IdleRestartTimings;
}): RelaunchView | undefined {
  if (!marker || now - marker.at > timings.relaunchFreshMs || now < marker.at) {
    return undefined;
  }
  if (marker.view === "hidden" && platform !== "darwin") {
    return "minimized";
  }
  return marker.view;
}

/**
 * The timings a development run uses: `IDLE_RESTART_FAST=1` turns each
 * minute into a second (and each day into 24 minutes) to exercise the
 * restart without waiting. A packaged build ignores it.
 */
export function idleRestartTimings({
  fast,
}: {
  fast: boolean;
}): IdleRestartTimings {
  if (!fast) {
    return IDLE_RESTART;
  }
  const scaled = (value: number) => Math.round(value / 60);
  return {
    ...IDLE_RESTART,
    personAwayMs: scaled(IDLE_RESTART.personAwayMs),
    quietMs: scaled(IDLE_RESTART.quietMs),
    recheckMs: ms("1 second"),
    seenAfterWaitingMs: scaled(IDLE_RESTART.seenAfterWaitingMs),
    seenSpacingMs: scaled(IDLE_RESTART.seenSpacingMs),
  };
}
