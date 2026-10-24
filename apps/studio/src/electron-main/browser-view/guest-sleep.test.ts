import type { AbsolutePath } from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import { browserTargetOf, StoreId } from "@instrument-org/workspace/electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type BrowserEntry, createEntry } from "./entry";
import { mayGuestSleep, sleepGuest, wakeGuest } from "./guest-sleep";

/** A guest whose page answers the frame probe with `frames`, in turn, then true. */
function makeGuest(frames: unknown[] = []) {
  const throttling: boolean[] = [];
  const probes = vi.fn(() => Promise.resolve(frames.shift() ?? true));
  const guest = {
    executeJavaScript: probes,
    hostWebContents: null,
    isDestroyed: () => false,
    setBackgroundThrottling: (on: boolean) => {
      throttling.push(on);
    },
  };
  // Only the members guest-sleep reaches; Electron's class cannot be built in a test.
  return { guest: guest as unknown as WebContents, probes, throttling };
}

function makeEntry(guest: WebContents): BrowserEntry {
  const entry = createEntry({
    partitionDir: "/tmp/partition" as AbsolutePath,
    targetId: browserTargetOf(StoreId.newTabId()),
  });
  entry.phase = "live";
  entry.webContents = guest;
  return entry;
}

const idle = { busy: false, fullScreen: false };

afterEach(() => {
  vi.useRealTimers();
});

describe("mayGuestSleep", () => {
  it("lets a parked, idle guest sleep", () => {
    expect(mayGuestSleep(makeEntry(makeGuest().guest), idle)).toBe(true);
  });

  it.each([
    ["shown", (entry: BrowserEntry) => (entry.shown = true), idle],
    [
      "recorded",
      (entry: BrowserEntry) =>
        (entry.screencastInterval = setInterval(() => {}, 1e6)),
      idle,
    ],
    ["busy", () => {}, { busy: true, fullScreen: false }],
    ["in full screen", () => {}, { busy: false, fullScreen: true }],
    [
      "not attached yet",
      (entry: BrowserEntry) => (entry.phase = "accepted"),
      idle,
    ],
  ])("keeps a guest awake while %s", (_, change, state) => {
    const entry = makeEntry(makeGuest().guest);
    change(entry);
    expect(mayGuestSleep(entry, state)).toBe(false);
    if (entry.screencastInterval) {
      clearInterval(entry.screencastInterval);
    }
  });
});

describe("wakeGuest", () => {
  it("turns throttling back off, tells the pool, and waits for a frame", async () => {
    const { guest, probes, throttling } = makeGuest([false, false]);
    const entry = makeEntry(guest);
    sleepGuest(entry, guest);
    const tellPool = vi.fn();

    await wakeGuest(entry, tellPool);

    expect(entry.asleep).toBe(false);
    expect(throttling).toEqual([true, false]);
    expect(tellPool).toHaveBeenCalledOnce();
    expect(probes).toHaveBeenCalledTimes(3);
  });

  it("does nothing for a guest that is awake", async () => {
    const { guest, probes, throttling } = makeGuest();
    const tellPool = vi.fn();

    await wakeGuest(makeEntry(guest), tellPool);

    expect(throttling).toEqual([]);
    expect(tellPool).not.toHaveBeenCalled();
    expect(probes).not.toHaveBeenCalled();
  });

  it("shares one wake between commands that arrive together", async () => {
    const { guest, throttling } = makeGuest([false]);
    const entry = makeEntry(guest);
    sleepGuest(entry, guest);
    const tellPool = vi.fn();

    await Promise.all([wakeGuest(entry, tellPool), wakeGuest(entry, tellPool)]);

    expect(throttling).toEqual([true, false]);
    expect(tellPool).toHaveBeenCalledOnce();
  });

  it("goes on without a frame from a page that never answers", async () => {
    vi.useFakeTimers();
    const { guest, probes } = makeGuest();
    probes.mockReturnValue(new Promise(() => {}));
    const entry = makeEntry(guest);
    sleepGuest(entry, guest);

    const woken = wakeGuest(entry, () => {});
    await vi.advanceTimersByTimeAsync(2000);

    await expect(woken).resolves.toBeUndefined();
    expect(entry.asleep).toBe(false);
  });
});
