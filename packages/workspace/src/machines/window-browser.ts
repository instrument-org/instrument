import ms from "ms";
import { noop } from "radashi";
import { type ActorRefFrom, fromCallback } from "xstate";

import { lastBrowserAgentActivity } from "../lib/browser-agent-activity";
import { type BrowserConfig, type BrowserTargetId } from "../types";

/** How long a tab the person has looked at keeps its page once off screen. */
export const SEEN_TAB_DISCARD_MS = ms("1 hour");

/** How long a tab only an agent opened, and nobody has looked at, keeps its page. */
export const UNSEEN_TAB_DISCARD_MS = ms("15 minutes");

/** How long an agent's last command keeps a tab's page, whatever its clock says. */
export const AGENT_PROTECTION_MS = ms("10 minutes");

/** How often hidden tabs are checked against their clocks. */
export const DISCARD_CHECK_MS = ms("1 minute");

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
      unwatch: noop,
    };
    guests.set(targetId, guest);
    // Called at once for a guest already gone, which leaves nothing behind.
    guest.unwatch = browser.onTargetDestroyed(targetId, () => {
      if (guests.get(targetId) === guest) {
        guests.delete(targetId);
      }
    });
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
        }
        return;
      }
    }
  });

  return () => {
    clearInterval(interval);
    for (const guest of guests.values()) {
      guest.unwatch();
    }
  };
});

export type WindowBrowserActorRef = ActorRefFrom<typeof windowBrowserLogic>;
