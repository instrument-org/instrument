import ms from "ms";
import { noop } from "radashi";
import { type ActorRefFrom, fromCallback } from "xstate";

import {
  lastBrowserAgentActivity,
  onBrowserAgentActivity,
} from "../lib/browser-agent-activity";
import { type BrowserConfig, type BrowserTargetId } from "../types";

/** How long a tab the person has looked at keeps its page once off screen. */
export const SEEN_TAB_DISCARD_MS = ms("1 hour");

/** How long a tab only an agent opened, and nobody has looked at, keeps its page. */
export const UNSEEN_TAB_DISCARD_MS = ms("15 minutes");

/** How long an agent's last command keeps a tab's page, whatever its clock says. */
export const AGENT_PROTECTION_MS = ms("10 minutes");

/** How often hidden tabs are checked against their clocks. */
export const DISCARD_CHECK_MS = ms("1 minute");

/**
 * How long a tab's page is off screen, and an agent's last command to it
 * past, before its guest sleeps: it stops drawing until the next command or
 * the window showing it wakes it.
 */
export const SLEEP_AFTER_MS = ms("5 seconds");

/** How long a working agent that drives a tab leaves it without a command before it sleeps all the same. */
export const DRIVEN_SLEEP_AFTER_MS = ms("2 minutes");

/**
 * How soon a tab kept awake by something no event announces (its guest
 * busy, a working agent driving it, a refusal from main, or a wake from a
 * command) is looked at again.
 */
export const SLEEP_RECHECK_MS = ms("10 seconds");

/** What the running window browser knows of a tab's page: whether it is drawn, and how long it has left. */
export interface TabLifetime {
  /** Whether a page of the window draws it. */
  drawn: boolean;
  /** How long it has been off screen, or null while drawn. */
  hiddenForMs: null | number;
  /** How long before its page is unloaded unless it is used, or null while drawn. */
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
  /** Being closed for its clock; not checked again. */
  discarding: boolean;
  /** When its page last left the screen, or null while drawn. */
  hiddenSince: null | number;
  /** Whether the person has seen its page since it was made. */
  seen: boolean;
  /** The look at whether it may sleep, waiting for when it might. */
  sleepTimer: ReturnType<typeof setTimeout> | undefined;
  unwatch: () => void;
}

/**
 * The lifetime of the window's browser guests, one tab at a time, on
 * Chromium's discard rules. A tab whose page is off screen keeps its guest
 * for a clock, then the guest goes and the tab stays in the strip with its
 * address: the window opens a fresh guest there when the tab is shown again.
 * A tab is never discarded while it is drawn, while an agent sent it a
 * command in the last ten minutes, while a working agent drives it, or while
 * the guest is busy (playing sound, downloading, or open in DevTools); such a
 * tab waits for the next check.
 *
 * Long before that, a tab sleeps (`BrowserConfig.sleepGuest`) once it has
 * been off screen, and an agent's last command to it past, for
 * `SLEEP_AFTER_MS`, or for `DRIVEN_SLEEP_AFTER_MS` since that command while a
 * working agent drives it: a guest out of sight otherwise draws every frame
 * its page animates. Each tab has a timer of its own for when it might, so
 * the seconds are real. A command or the window showing it wakes it again,
 * and it sleeps once more when it has been quiet as long again.
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
  // Kept apart from the guests: a page stays drawn across its guest going
  // and coming back (a crash, a reload), and the guest that returns is
  // still on screen.
  const leases = new Map<BrowserTargetId, number>();

  const isDrawn = (targetId: BrowserTargetId) =>
    (leases.get(targetId) ?? 0) > 0;

  const register = (targetId: BrowserTargetId) => {
    if (guests.has(targetId)) {
      return;
    }
    const drawn = isDrawn(targetId);
    const guest: Guest = {
      discarding: false,
      hiddenSince: drawn ? null : now(),
      seen: drawn,
      sleepTimer: undefined,
      unwatch: noop,
    };
    guests.set(targetId, guest);
    // Called at once for a guest already gone, which leaves nothing behind.
    guest.unwatch = browser.onTargetDestroyed(targetId, () => {
      clearTimeout(guest.sleepTimer);
      if (guests.get(targetId) === guest) {
        guests.delete(targetId);
      }
    });
    if (guests.get(targetId) === guest && guest.hiddenSince !== null) {
      scheduleSleep(targetId, guest, 0);
    }
  };

  /** How long until the tab has been off screen, and its agent quiet for `quietMs`, long enough to sleep. */
  const sleepDueIn = (
    targetId: BrowserTargetId,
    guest: Guest,
    quietMs: number,
  ) => {
    const hidden =
      guest.hiddenSince === null
        ? Number.POSITIVE_INFINITY
        : SLEEP_AFTER_MS - (now() - guest.hiddenSince);
    const agentAt = lastBrowserAgentActivity(targetId);
    const quiet = agentAt === undefined ? 0 : quietMs - (Date.now() - agentAt);
    return Math.max(hidden, quiet);
  };

  const scheduleSleep = (
    targetId: BrowserTargetId,
    guest: Guest,
    delay: number,
  ) => {
    clearTimeout(guest.sleepTimer);
    guest.sleepTimer = setTimeout(
      () => {
        guest.sleepTimer = undefined;
        void trySleep(targetId, guest);
      },
      Math.max(0, delay),
    );
  };

  const trySleep = async (targetId: BrowserTargetId, guest: Guest) => {
    const current = () =>
      guests.get(targetId) === guest &&
      !guest.discarding &&
      guest.hiddenSince !== null;
    if (!current()) {
      return;
    }
    // Asleep already, or woken since by something no event here announces:
    // looked at again in a while either way.
    if (browser.isGuestAsleep(targetId)) {
      scheduleSleep(targetId, guest, SLEEP_RECHECK_MS);
      return;
    }
    const due = sleepDueIn(targetId, guest, SLEEP_AFTER_MS);
    if (due > 0) {
      scheduleSleep(targetId, guest, due);
      return;
    }
    if (browser.isGuestBusy(targetId)) {
      scheduleSleep(targetId, guest, SLEEP_RECHECK_MS);
      return;
    }
    // A tab whose drivers cannot be read counts as driven.
    if (await isDrivenByWorkingAgent(targetId).catch(() => true)) {
      const drivenDue = sleepDueIn(targetId, guest, DRIVEN_SLEEP_AFTER_MS);
      if (drivenDue > 0) {
        scheduleSleep(targetId, guest, Math.min(drivenDue, SLEEP_RECHECK_MS));
        return;
      }
    }
    // Drawn again, or gone, while the working agents were asked about.
    if (!current()) {
      return;
    }
    browser.sleepGuest(targetId);
    scheduleSleep(targetId, guest, SLEEP_RECHECK_MS);
  };

  const check = async () => {
    const at = now();
    for (const [targetId, guest] of guests) {
      if (guest.discarding || guest.hiddenSince === null) {
        continue;
      }
      const clock = guest.seen ? SEEN_TAB_DISCARD_MS : UNSEEN_TAB_DISCARD_MS;
      if (at - guest.hiddenSince < clock) {
        continue;
      }
      const agentAt = lastBrowserAgentActivity(targetId);
      if (
        (agentAt !== undefined && Date.now() - agentAt < AGENT_PROTECTION_MS) ||
        browser.isGuestBusy(targetId) ||
        // A tab whose drivers cannot be read is left for the next check.
        (await isDrivenByWorkingAgent(targetId).catch(() => true))
      ) {
        continue;
      }
      // Drawn again while the working agents were asked about.
      if (guest.hiddenSince === null || guests.get(targetId) !== guest) {
        continue;
      }
      guest.discarding = true;
      void browser.closeTarget(targetId);
    }
  };

  // A command restarts the tab's quiet; the timer looks again once it has
  // been quiet long enough.
  const stopActivity = onBrowserAgentActivity((targetId) => {
    const guest = guests.get(targetId);
    if (guest && guest.hiddenSince !== null) {
      scheduleSleep(targetId, guest, SLEEP_AFTER_MS);
    }
  });

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
      unloadsInMs: Math.max(0, clock - hiddenForMs, protectedFor),
    };
  };
  readLifetime = lifetime;

  let checking = false;
  const interval = setInterval(() => {
    if (checking) {
      return;
    }
    checking = true;
    void check().finally(() => {
      checking = false;
    });
  }, DISCARD_CHECK_MS);

  receive((event) => {
    const { targetId } = event.value;
    switch (event.type) {
      case "acquireVisible": {
        leases.set(targetId, (leases.get(targetId) ?? 0) + 1);
        const guest = guests.get(targetId);
        if (guest) {
          guest.hiddenSince = null;
          guest.seen = true;
          clearTimeout(guest.sleepTimer);
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
          guest.hiddenSince = now();
          scheduleSleep(targetId, guest, SLEEP_AFTER_MS);
        }
        return;
      }
    }
  });

  return () => {
    clearInterval(interval);
    stopActivity();
    if (readLifetime === lifetime) {
      readLifetime = undefined;
    }
    for (const guest of guests.values()) {
      clearTimeout(guest.sleepTimer);
      guest.unwatch();
    }
  };
});

export type WindowBrowserActorRef = ActorRefFrom<typeof windowBrowserLogic>;
