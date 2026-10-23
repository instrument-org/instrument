import type { WebContents } from "electron";

import { whileEmbedderComposites } from "./embedder-draw";
import { type BrowserEntry, hasGuest } from "./entry";
import { log } from "./log";

// A guest no slot shows stays in paint-host, laid out and painted so capture
// and CDP input keep working, and with background throttling off it draws
// every frame of whatever the page animates, for as long as the tab lives. A
// guest asleep stops drawing: the pool hides its element (`visibility:
// hidden`) and its background throttling comes back on, so it renders no
// frames, runs no animation frames and has its timers throttled. The page and
// its state stay as they were, so waking it is undoing both and waiting for a
// frame, with no reload.

/** How long a woken guest is given to render a frame before the command that woke it goes on anyway. */
const WAKE_FRAME_TIMEOUT_MS = 2000;

const FRAME_PROBE_SCRIPT =
  "new Promise((resolve) => { requestAnimationFrame(() => resolve(true)); setTimeout(() => resolve(false), 250); })";

/** Wakes already under way, so a burst of commands waits on one frame. */
const waking = new WeakMap<BrowserEntry, Promise<void>>();

/**
 * Whether a guest may sleep: not while a slot shows it, its page is in HTML
 * full screen, the agent is recording it, or it is busy the way the discard
 * rules count it (sound, a download, DevTools).
 */
export function mayGuestSleep(
  entry: BrowserEntry,
  { busy, fullScreen }: { busy: boolean; fullScreen: boolean },
): boolean {
  const guest = entry.webContents;
  return (
    hasGuest(entry) &&
    guest !== null &&
    !guest.isDestroyed() &&
    !entry.shown &&
    !fullScreen &&
    entry.screencastInterval === null &&
    !busy
  );
}

/** Puts the guest to sleep; the caller has checked `mayGuestSleep` and tells the pool. */
export function sleepGuest(entry: BrowserEntry, guest: WebContents) {
  entry.asleep = true;
  guest.setBackgroundThrottling(true);
  log.info(`guest asleep targetId=${entry.targetId}`);
}

/**
 * Wakes a sleeping guest, the caller telling the pool to show its element
 * again: settles once the guest has rendered a frame, or after
 * WAKE_FRAME_TIMEOUT_MS, so the command behind it never hangs on the wake.
 */
export function wakeGuest(
  entry: BrowserEntry,
  tellPool: () => void,
): Promise<void> {
  const pending = waking.get(entry);
  if (pending) {
    return pending;
  }
  const guest = entry.webContents;
  if (!entry.asleep || !guest || guest.isDestroyed()) {
    entry.asleep = false;
    return Promise.resolve();
  }
  entry.asleep = false;
  guest.setBackgroundThrottling(false);
  tellPool();
  const startedAt = Date.now();
  const woken = (async () => {
    try {
      const drew = await whileEmbedderComposites(guest, firstFrame(guest));
      log.info(
        `guest awake targetId=${entry.targetId} frame=${drew ? "yes" : "no"} after=${Date.now() - startedAt}ms`,
      );
    } finally {
      waking.delete(entry);
    }
  })();
  waking.set(entry, woken);
  return woken;
}

// Asks the guest for an animation frame until it renders one or the wake's
// budget runs out. The pool's element becomes visible a round trip after the
// wake, so the first asks can come back empty.
async function firstFrame(guest: WebContents): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let outOfTime = false;
  const deadline = new Promise<false>((resolve) => {
    timeout = setTimeout(() => {
      outOfTime = true;
      resolve(false);
    }, WAKE_FRAME_TIMEOUT_MS);
  });
  const drawn = (async () => {
    while (!outOfTime && !guest.isDestroyed()) {
      const drew: unknown = await guest
        .executeJavaScript(FRAME_PROBE_SCRIPT)
        .catch(() => false);
      if (drew === true) {
        return true;
      }
    }
    return false;
  })();
  try {
    // A page whose main thread is blocked never answers the probe, so the
    // wait is bounded here rather than in the page.
    return await Promise.race([drawn, deadline]);
  } finally {
    clearTimeout(timeout);
    outOfTime = true;
  }
}
