import ms from "ms";
import { noop, sift } from "radashi";
import { type ActorRefFrom, fromCallback } from "xstate";

import {
  lastBrowserAgentActivity,
  onBrowserAgentActivity,
} from "../lib/browser-agent-activity";
import { type BrowserConfig, type BrowserTargetId } from "../types";
import {
  AGENT_PROTECTION_MS,
  type MemoryLevel,
  nextLookInMs,
  nextPageState,
  type PageEvent,
  type PageFacts,
  type PageState,
  pagesToClose,
  SEEN_TAB_DISCARD_MS,
  SLEEP_AFTER_MS,
  UNSEEN_TAB_DISCARD_MS,
} from "./page-lifetime";

export {
  AGENT_PROTECTION_MS,
  DRIVEN_SLEEP_AFTER_MS,
  SEEN_TAB_DISCARD_MS,
  SLEEP_AFTER_MS,
  SLEEP_RECHECK_MS,
  UNSEEN_TAB_DISCARD_MS,
} from "./page-lifetime";

/**
 * How often the system's memory level is read while it is normal, the check
 * that closes pages before their clocks run out.
 */
export const DISCARD_CHECK_MS = ms("1 minute");

/** How often the memory level is read while it is low or critical, closing one page each time. */
export const MEMORY_RECHECK_MS = ms("5 seconds");

/** What the running window browser knows of a tab's page: whether it is drawn, and how long it has left. */
export interface TabLifetime {
  /** Whether a page of the window draws it. */
  drawn: boolean;
  /** How long it has been off screen, or null while drawn. */
  hiddenForMs: null | number;
  /**
   * How long before its page is unloaded unless it is used, or null while
   * drawn and while it holds something a person entered.
   */
  unloadsInMs: null | number;
}

let readLifetime:
  | ((targetId: BrowserTargetId) => TabLifetime | undefined)
  | undefined;

/** The running window browser's account of a tab, or undefined for one it holds no guest for. */
export function tabLifetime(
  targetId: BrowserTargetId,
): TabLifetime | undefined {
  return readLifetime?.(targetId);
}

export type WindowBrowserEvent =
  /** A tab's page is drawn: the tab up in its group, a page beside a chat, in a draft's band, or Quick Look. */
  | { type: "acquireVisible"; value: { targetId: BrowserTargetId } }
  | { type: "registerTarget"; value: { targetId: BrowserTargetId } }
  | { type: "releaseVisible"; value: { targetId: BrowserTargetId } };

export interface WindowBrowserInput {
  browser: BrowserConfig;
  /** Whether an agent that is working right now drives the tab: a task, or the chat's own conversation. */
  isDrivenByWorkingAgent: (targetId: BrowserTargetId) => Promise<boolean>;
  /** A clock that stops while the computer sleeps, so a night asleep is not hours out of sight. */
  now?: () => number;
}

interface Guest {
  /** Being closed; not looked at again. */
  discarding: boolean;
  /** When its page last left the screen, or null while drawn. */
  hiddenSince: null | number;
  /** The next look at it, waiting for when its state might change. */
  lookTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the person has seen its page since it was made. */
  seen: boolean;
  unwatch: () => void;
}

/**
 * The lifetime of the window's browser guests, one tab at a time, on
 * Chromium's discard rules, which `nextPageState` (`page-lifetime.ts`) holds
 * whole. This owns the timers, asks main for each page's facts, and carries
 * out what the rules return: `asleep` is `BrowserConfig.sleepGuest`, and
 * `closed` is `discardTarget`, after which the tab stays in the strip with
 * its address and the window opens a fresh guest there when it is shown
 * again.
 *
 * Each page out of sight has a timer of its own for when it could next
 * sleep or its clock runs out, so the seconds are real, and is looked at
 * every few seconds while something no event announces keeps it as it is.
 * Where main can read the system's memory level (`BrowserConfig.memoryLevel`),
 * it is read each minute, and every few seconds while it is not normal, and
 * each reading under pressure closes the first page `pagesToClose` names.
 *
 * Opening and closing tabs is not this actor's: a guest is made when a tab
 * is opened or shown and destroyed when its tab closes, and this only follows
 * along (`registerTarget`, and each guest's destruction).
 */
export const windowBrowserLogic = fromCallback<
  WindowBrowserEvent,
  WindowBrowserInput
>(({ input, receive }) => {
  const { browser, isDrivenByWorkingAgent } = input;
  const now = input.now ?? (() => performance.now());
  const guests = new Map<BrowserTargetId, Guest>();
  // Set once the actor stops: nothing is scheduled or carried out after.
  let stopped = false;
  // Kept apart from the guests: a page stays drawn across its guest going
  // and coming back (a crash, a reload), and the guest that returns is
  // still on screen.
  const leases = new Map<BrowserTargetId, number>();

  const isDrawn = (targetId: BrowserTargetId) =>
    (leases.get(targetId) ?? 0) > 0;

  const stateOf = (targetId: BrowserTargetId, guest: Guest): PageState => {
    if (guest.hiddenSince === null) {
      return "drawn";
    }
    return browser.isGuestAsleep(targetId) ? "asleep" : "hidden";
  };

  /**
   * Whether the guest is still the tab's, out of sight since `hiddenSince`,
   * and not on its way out.
   */
  const isCurrent = (
    targetId: BrowserTargetId,
    guest: Guest,
    hiddenSince: number,
  ) =>
    guests.get(targetId) === guest &&
    !guest.discarding &&
    guest.hiddenSince === hiddenSince;

  /**
   * Where a page out of sight stands and what is true of it, or undefined
   * once it is drawn again, gone, or on its way out, the moment the working
   * agents were asked about included.
   */
  const pageOf = async (targetId: BrowserTargetId, guest: Guest) => {
    const { hiddenSince } = guest;
    if (hiddenSince === null || !isCurrent(targetId, guest, hiddenSince)) {
      return undefined;
    }
    // A tab whose drivers cannot be read counts as driven.
    const drivenByWorkingAgent = await isDrivenByWorkingAgent(targetId).catch(
      () => true,
    );
    if (!isCurrent(targetId, guest, hiddenSince)) {
      return undefined;
    }
    const agentAt = lastBrowserAgentActivity(targetId);
    const facts: PageFacts = {
      agentQuietForMs:
        agentAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - agentAt,
      busy: browser.isGuestBusy(targetId),
      drivenByWorkingAgent,
      edited: browser.isGuestEdited(targetId),
      hiddenForMs: now() - hiddenSince,
      seen: guest.seen,
    };
    return {
      facts,
      guest,
      hiddenSince,
      state: stateOf(targetId, guest),
      targetId,
    };
  };

  const scheduleLook = (
    targetId: BrowserTargetId,
    guest: Guest,
    delay: number,
  ) => {
    clearTimeout(guest.lookTimer);
    if (stopped) {
      return;
    }
    guest.lookTimer = setTimeout(
      () => {
        guest.lookTimer = undefined;
        void look(targetId, guest);
      },
      Math.max(0, delay),
    );
  };

  /** Carries out a transition the rules returned for a page out of sight. */
  const enter = (
    targetId: BrowserTargetId,
    guest: Guest,
    from: PageState,
    to: PageState,
  ) => {
    if (stopped) {
      return;
    }
    if (to === "closed") {
      clearTimeout(guest.lookTimer);
      guest.discarding = true;
      void browser.discardTarget(targetId);
    } else if (to === "asleep" && from === "hidden") {
      browser.sleepGuest(targetId);
    }
  };

  /** Applies a tick to a page out of sight, and sets its next look. */
  const look = async (targetId: BrowserTargetId, guest: Guest) => {
    const page = await pageOf(targetId, guest);
    if (!page) {
      return;
    }
    const to = nextPageState(page.state, { facts: page.facts, type: "tick" });
    enter(targetId, guest, page.state, to);
    if (to !== "closed") {
      scheduleLook(targetId, guest, nextLookInMs(to, page.facts));
    }
  };

  /**
   * Applies an event that needs no facts: the page shown, hidden, or sent a
   * command. Main itself wakes a sleeping page shown or sent a command, and
   * a closed page has no guest here, so only the clock is this one's.
   */
  const apply = (
    targetId: BrowserTargetId,
    guest: Guest,
    event: Extract<PageEvent, { type: "agentCommand" | "hidden" | "shown" }>,
  ) => {
    const from = stateOf(targetId, guest);
    const to = nextPageState(from, event);
    if (to === "drawn") {
      guest.hiddenSince = null;
      guest.seen = true;
      clearTimeout(guest.lookTimer);
      return;
    }
    if (from === "drawn") {
      guest.hiddenSince = now();
    }
    // Left the screen, or a command restarted its quiet: looked at again
    // once it could sleep.
    scheduleLook(targetId, guest, SLEEP_AFTER_MS);
  };

  const register = (targetId: BrowserTargetId) => {
    if (guests.has(targetId)) {
      return;
    }
    const drawn = isDrawn(targetId);
    const guest: Guest = {
      discarding: false,
      hiddenSince: drawn ? null : now(),
      lookTimer: undefined,
      seen: drawn,
      unwatch: noop,
    };
    guests.set(targetId, guest);
    // Called at once for a guest already gone, which leaves nothing behind.
    guest.unwatch = browser.onTargetDestroyed(targetId, () => {
      clearTimeout(guest.lookTimer);
      if (guests.get(targetId) === guest) {
        guests.delete(targetId);
      }
    });
    if (guests.get(targetId) === guest && guest.hiddenSince !== null) {
      scheduleLook(targetId, guest, 0);
    }
  };

  // A command restarts the tab's quiet; the timer looks again once it has
  // been quiet long enough.
  const stopActivity = onBrowserAgentActivity((targetId) => {
    const guest = guests.get(targetId);
    if (guest && guest.hiddenSince !== null) {
      apply(targetId, guest, { type: "agentCommand" });
    }
  });

  let memory: MemoryLevel = "normal";
  let memoryTimer: ReturnType<typeof setTimeout> | undefined;
  let readFailed = false;

  /** Closes the first page the memory level names, if any. */
  const closeForMemory = async (level: MemoryLevel) => {
    const pages = await Promise.all(
      [...guests].map(([targetId, guest]) => pageOf(targetId, guest)),
    );
    const [first] = pagesToClose(sift(pages), level);
    // Drawn again, or gone, while the other pages were looked at.
    if (!first || !isCurrent(first.targetId, first.guest, first.hiddenSince)) {
      return;
    }
    console.info(
      `page closed for memory targetId=${first.targetId} level=${level} state=${first.state} hiddenFor=${Math.round(first.facts.hiddenForMs / 1000)}s`,
    );
    enter(first.targetId, first.guest, first.state, "closed");
  };

  const readMemory = async () => {
    const read = browser.memoryLevel;
    if (!read || stopped) {
      return;
    }
    // A reading that fails keeps the last level: failing to start a process
    // is likeliest when memory is shortest.
    const level = await read().then(
      (reading) => {
        readFailed = false;
        return reading;
      },
      (error: unknown) => {
        if (!readFailed) {
          console.warn(`memory level unread, kept at ${memory}`, error);
        }
        readFailed = true;
        return memory;
      },
    );
    if (stopped) {
      return;
    }
    if (level !== memory) {
      console.info(`memory pressure ${memory} -> ${level}`);
      memory = level;
    }
    if (level !== "normal") {
      await closeForMemory(level);
    }
    if (!stopped) {
      memoryTimer = setTimeout(
        () => void readMemory(),
        level === "normal" ? DISCARD_CHECK_MS : MEMORY_RECHECK_MS,
      );
    }
  };
  if (browser.memoryLevel) {
    memoryTimer = setTimeout(() => void readMemory(), DISCARD_CHECK_MS);
  }

  const lifetime = (targetId: BrowserTargetId): TabLifetime | undefined => {
    const guest = guests.get(targetId);
    if (!guest) {
      return undefined;
    }
    if (guest.hiddenSince === null) {
      return { drawn: true, hiddenForMs: null, unloadsInMs: null };
    }
    const hiddenForMs = now() - guest.hiddenSince;
    const clock = guest.seen ? SEEN_TAB_DISCARD_MS : UNSEEN_TAB_DISCARD_MS;
    const agentAt = lastBrowserAgentActivity(targetId);
    const protectedFor =
      agentAt === undefined ? 0 : AGENT_PROTECTION_MS - (Date.now() - agentAt);
    return {
      drawn: false,
      hiddenForMs,
      unloadsInMs: browser.isGuestEdited(targetId)
        ? null
        : Math.max(0, clock - hiddenForMs, protectedFor),
    };
  };
  readLifetime = lifetime;

  receive((event) => {
    const { targetId } = event.value;
    switch (event.type) {
      case "acquireVisible": {
        leases.set(targetId, (leases.get(targetId) ?? 0) + 1);
        const guest = guests.get(targetId);
        if (guest) {
          apply(targetId, guest, { type: "shown" });
        }
        return;
      }
      case "registerTarget": {
        register(targetId);
        return;
      }
      case "releaseVisible": {
        const count = (leases.get(targetId) ?? 0) - 1;
        if (count > 0) {
          leases.set(targetId, count);
          return;
        }
        leases.delete(targetId);
        const guest = guests.get(targetId);
        if (guest) {
          apply(targetId, guest, { type: "hidden" });
        }
        return;
      }
    }
  });

  return () => {
    stopped = true;
    clearTimeout(memoryTimer);
    stopActivity();
    if (readLifetime === lifetime) {
      readLifetime = undefined;
    }
    for (const guest of guests.values()) {
      clearTimeout(guest.lookTimer);
      guest.unwatch();
    }
    guests.clear();
  };
});

export type WindowBrowserActorRef = ActorRefFrom<typeof windowBrowserLogic>;
