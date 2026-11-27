import ms from "ms";

// The rules a browser tab's page lives by while its tab stays open, as pure
// functions: no timers, no Electron. `windowBrowserLogic` owns the timers,
// asks main for the facts, and carries out what these return.

/** How long a tab the person has looked at keeps its page once off screen. */
export const SEEN_TAB_DISCARD_MS = ms("1 hour");

/** How long a tab only an agent opened, and nobody has looked at, keeps its page. */
export const UNSEEN_TAB_DISCARD_MS = ms("15 minutes");

/** How long an agent's last command keeps a tab's page, whatever its clock says. */
export const AGENT_PROTECTION_MS = ms("10 minutes");

/**
 * How long a tab's page is off screen, and an agent's last command to it
 * past, before its guest sleeps: it stops drawing until the next command or
 * the window showing it wakes it.
 */
export const SLEEP_AFTER_MS = ms("5 seconds");

/** How long a working agent that drives a tab leaves it without a command before it sleeps all the same. */
export const DRIVEN_SLEEP_AFTER_MS = ms("2 minutes");

/**
 * How soon a page out of sight is looked at again when nothing it knows of
 * says when it next could change: its guest asleep, busy, or driven by a
 * working agent, or anything else no event announces.
 */
export const SLEEP_RECHECK_MS = ms("10 seconds");

/**
 * Where a tab's page stands. `drawn`: a slot shows it. `hidden`: off screen,
 * its guest still drawing. `asleep`: off screen, its guest kept but drawing
 * nothing. `closed`: its guest gone, the tab keeping its address to load
 * again when shown.
 */
export type PageState = "asleep" | "closed" | "drawn" | "hidden";

/** How short the system is of memory, by its own account: `low` is macOS's warning level, `critical` its critical one. */
export type MemoryLevel = "critical" | "low" | "normal";

/** What is true of a page off screen at the moment its rules are applied. */
export interface PageFacts {
  /** How long since an agent last sent it a command; infinite when none has since launch. */
  agentQuietForMs: number;
  /** Playing sound, downloading, in a call on the microphone or camera, or open in DevTools. */
  busy: boolean;
  /** An agent with a turn running drives it. A page whose drivers cannot be read counts as driven. */
  drivenByWorkingAgent: boolean;
  /** It holds something a person entered, which unloading it would lose. */
  edited: boolean;
  /** How long it has been off screen. */
  hiddenForMs: number;
  /** The person has seen it since its guest was made. */
  seen: boolean;
}

export type PageEvent =
  /** A command from an agent reached it, waking it if it slept. */
  | { type: "agentCommand" }
  /** It left the screen. */
  | { type: "hidden" }
  /** The system's memory level was read. */
  | { facts: PageFacts; level: MemoryLevel; type: "memory" }
  /** A slot shows it: a closed page loads its address again, a sleeping one wakes. */
  | { type: "shown" }
  /** Time passed. */
  | { facts: PageFacts; type: "tick" };

/**
 * Whether nothing may close the page: an agent sent it a command in the last
 * `AGENT_PROTECTION_MS`, a working agent drives it, its guest is busy, or it
 * holds something a person entered.
 */
function isProtected(facts: PageFacts): boolean {
  return (
    facts.agentQuietForMs < AGENT_PROTECTION_MS ||
    facts.drivenByWorkingAgent ||
    facts.busy ||
    facts.edited
  );
}

/** How long a page out of sight keeps its guest: longer once the person has seen it. */
function clockMs(facts: PageFacts): number {
  return facts.seen ? SEEN_TAB_DISCARD_MS : UNSEEN_TAB_DISCARD_MS;
}

/** How long an agent leaves the page without a command before it may sleep. */
function quietBeforeSleepMs(facts: PageFacts): number {
  return facts.drivenByWorkingAgent ? DRIVEN_SLEEP_AFTER_MS : SLEEP_AFTER_MS;
}

/**
 * The state a page goes to on an event. Every rule of a page's lifetime is
 * one branch here, and one row of the table in `page-lifetime.test.ts`.
 */
export function nextPageState(state: PageState, event: PageEvent): PageState {
  switch (event.type) {
    case "shown": {
      return "drawn";
    }
    case "hidden": {
      return state === "drawn" ? "hidden" : state;
    }
    case "agentCommand": {
      return state === "asleep" ? "hidden" : state;
    }
    case "tick": {
      if (state !== "hidden" && state !== "asleep") {
        return state;
      }
      const { facts } = event;
      if (facts.hiddenForMs >= clockMs(facts) && !isProtected(facts)) {
        return "closed";
      }
      if (
        state === "hidden" &&
        facts.hiddenForMs >= SLEEP_AFTER_MS &&
        facts.agentQuietForMs >= quietBeforeSleepMs(facts) &&
        !facts.busy
      ) {
        return "asleep";
      }
      return state;
    }
    case "memory": {
      // A page left less than a sleep's wait ago is likely to be shown
      // again; one still awake past it is one main would not put to sleep.
      if (
        isProtected(event.facts) ||
        event.facts.hiddenForMs < SLEEP_AFTER_MS
      ) {
        return state;
      }
      if (state === "asleep" && event.level !== "normal") {
        return "closed";
      }
      if (state === "hidden" && event.level === "critical") {
        return "closed";
      }
      return state;
    }
  }
}

/**
 * The pages a memory level closes, in the order they go: the one off screen
 * longest first.
 */
export function pagesToClose<
  Page extends { facts: PageFacts; state: PageState },
>(pages: readonly Page[], level: MemoryLevel): Page[] {
  return pages
    .filter(
      ({ facts, state }) =>
        nextPageState(state, { facts, level, type: "memory" }) === "closed",
    )
    .toSorted((a, b) => b.facts.hiddenForMs - a.facts.hiddenForMs);
}

/**
 * How soon to look at a page out of sight again: when it could next sleep
 * or its clock runs out, and every `SLEEP_RECHECK_MS` while what keeps it
 * is something no event announces.
 */
export function nextLookInMs(state: PageState, facts: PageFacts): number {
  const clockLeft = clockMs(facts) - facts.hiddenForMs;
  return Math.min(
    state === "hidden" ? sleepLookInMs(facts) : SLEEP_RECHECK_MS,
    clockLeft > 0 ? clockLeft : Number.POSITIVE_INFINITY,
  );
}

function sleepLookInMs(facts: PageFacts): number {
  const due = Math.max(
    SLEEP_AFTER_MS - facts.hiddenForMs,
    SLEEP_AFTER_MS - facts.agentQuietForMs,
  );
  if (due > 0) {
    return due;
  }
  const drivenDue = DRIVEN_SLEEP_AFTER_MS - facts.agentQuietForMs;
  return !facts.busy && facts.drivenByWorkingAgent && drivenDue > 0
    ? Math.min(drivenDue, SLEEP_RECHECK_MS)
    : SLEEP_RECHECK_MS;
}
