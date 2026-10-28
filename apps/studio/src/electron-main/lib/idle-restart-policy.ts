import ms from "ms";

/**
 * When the app restarts on its own to apply a staged update. Every value is a
 * starting value, to be tuned once restarts are seen in use.
 */
export const IDLE_RESTART = {
  /** How long the screen must stay locked for a restart. */
  lockedMs: ms("1 minute"),
  /** How long no window may be showing (closed, hidden or minimized) for a restart. */
  noWindowMs: ms("5 minutes"),
  /** How long the computer must go without input for a restart. */
  personAwayMs: ms("15 minutes"),
  /** How long an update may wait for one of those before the backstop. */
  backstopAfterMs: ms("3 days"),
  /** How long every blocker must stay clear before the backstop restarts in view. */
  backstopQuietMs: ms("10 minutes"),
  /** The least time between two automatic restarts of any kind. */
  spacingMs: ms("1 hour"),
  /** How long a check of what is running may take before it counts as busy. */
  checkTimeoutMs: ms("10 seconds"),
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
  /**
   * Agents, jobs, dictation, and the microphone or camera where the system
   * says; `unknown` when a check failed or took too long.
   */
  work: "busy" | "idle" | "unknown";
  windows: { focused: boolean; fullScreen: boolean; shown: boolean };
  /** No input for this long; locked since then, or not locked. */
  person: { awayMs: number; lockedSince: number | undefined };
  lastAutomaticRestartAt: number | undefined;
};

/** What the readings so far add up to: since when each condition has held. */
export type IdleRestartState = {
  /** Since when every blocker has been clear. */
  quietSince: number | undefined;
  /** Since when no window has been showing. */
  noWindowSince: number | undefined;
};

type IdleRestartBlocker =
  | "attempts-used"
  | "focused"
  | "full-screen"
  | "no-update"
  | "restarted-recently"
  | "update-busy"
  | "work-busy"
  | "work-unknown"
  // Nothing in the way, and no sign yet that the person has stepped away.
  | "in-use";

/** What made a restart go: the person stepped away, or the backstop. */
type IdleRestartReason = "away" | "backstop" | "locked" | "no-window";

export type IdleRestartVerdict =
  | { blocker: IdleRestartBlocker; type: "wait" }
  | { reason: IdleRestartReason; type: "restart" };

function blockerOf(
  facts: IdleRestartFacts,
  timings: IdleRestartTimings,
): Exclude<IdleRestartBlocker, "in-use"> | undefined {
  if (facts.update.type === "none") {
    return "no-update";
  }
  if (facts.update.type === "busy") {
    return "update-busy";
  }
  if (facts.attempts >= timings.maxAttempts) {
    return "attempts-used";
  }
  if (
    facts.lastAutomaticRestartAt !== undefined &&
    facts.now - facts.lastAutomaticRestartAt < timings.spacingMs
  ) {
    return "restarted-recently";
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

/** The first sign the person stepped away, or the backstop, or nothing. */
function reasonOf(
  facts: IdleRestartFacts,
  state: IdleRestartState,
  timings: IdleRestartTimings,
): IdleRestartReason | undefined {
  const heldFor = (since: number | undefined) =>
    since === undefined ? -1 : facts.now - since;
  if (heldFor(facts.person.lockedSince) >= timings.lockedMs) {
    return "locked";
  }
  if (heldFor(state.noWindowSince) >= timings.noWindowMs) {
    return "no-window";
  }
  if (facts.person.awayMs >= timings.personAwayMs) {
    return "away";
  }
  if (
    facts.update.type === "ready" &&
    facts.now - facts.update.stagedSince >= timings.backstopAfterMs &&
    heldFor(state.quietSince) >= timings.backstopQuietMs
  ) {
    return "backstop";
  }
  return undefined;
}

/**
 * One reading of the facts: the state carried to the next reading, and what
 * to do now. A blocker resets the backstop's countdown, so a window taking
 * focus starts it over; a window coming into view resets the no-window one.
 * The last look before the quit is one more reading.
 */
export function stepIdleRestart({
  facts,
  state,
  timings = IDLE_RESTART,
}: {
  facts: IdleRestartFacts;
  state: IdleRestartState;
  timings?: IdleRestartTimings;
}): { state: IdleRestartState; verdict: IdleRestartVerdict } {
  const blocker = blockerOf(facts, timings);
  const next: IdleRestartState = {
    noWindowSince: facts.windows.shown
      ? undefined
      : (state.noWindowSince ?? facts.now),
    quietSince: blocker ? undefined : (state.quietSince ?? facts.now),
  };
  if (blocker) {
    return { state: next, verdict: { blocker, type: "wait" } };
  }
  const reason = reasonOf(facts, next, timings);
  return {
    state: next,
    verdict: reason
      ? { reason, type: "restart" }
      : { blocker: "in-use", type: "wait" },
  };
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
 * The timings a test run uses: `IDLE_RESTART_FAST=1` turns each minute into a
 * second, the backstop's three days into 30 seconds and the hour between
 * restarts into one minute, to exercise the restart without waiting. Read in
 * a development run or a preview build, never in a shipping one.
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
    backstopAfterMs: ms("30 seconds"),
    backstopQuietMs: scaled(IDLE_RESTART.backstopQuietMs),
    lockedMs: scaled(IDLE_RESTART.lockedMs),
    noWindowMs: scaled(IDLE_RESTART.noWindowMs),
    personAwayMs: scaled(IDLE_RESTART.personAwayMs),
    recheckMs: ms("1 second"),
    spacingMs: scaled(IDLE_RESTART.spacingMs),
  };
}
