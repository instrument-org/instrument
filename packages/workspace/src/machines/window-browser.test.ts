import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { noteBrowserAgentActivity } from "../lib/browser-agent-activity";
import { StoreId } from "../schemas/store-id";
import {
  type BrowserConfig,
  type BrowserTargetId,
  browserTargetOf,
} from "../types";
import {
  AGENT_PROTECTION_MS,
  DISCARD_CHECK_MS,
  SEEN_TAB_DISCARD_MS,
  SLEEP_AFTER_MS,
  SLEEP_CHECK_MS,
  UNSEEN_TAB_DISCARD_MS,
  windowBrowserLogic,
} from "./window-browser";

/** A browser whose guests live until closed, with the closes and sleeps it was asked for. */
function makeBrowser() {
  const destroyed = new Map<BrowserTargetId, () => void>();
  const busy = new Set<BrowserTargetId>();
  const closed: BrowserTargetId[] = [];
  const asleep = new Set<BrowserTargetId>();
  const slept: BrowserTargetId[] = [];
  const browser: BrowserConfig = {
    closeTarget: (targetId) => {
      closed.push(targetId);
      destroyed.get(targetId)?.();
      return Promise.resolve();
    },
    contentBlocking: () => ({ task: true, workspace: true }),
    createTarget: () => Promise.resolve(),
    getTargetMeta: () => null,
    getTargetUrl: () => undefined,
    hasNoWindow: false,
    isGuestAsleep: (targetId) => asleep.has(targetId),
    isGuestBusy: (targetId) => busy.has(targetId),
    listTargets: () => Promise.resolve([]),
    onTargetDestroyed: (targetId, listener) => {
      destroyed.set(targetId, listener);
      return () => {
        destroyed.delete(targetId);
      };
    },
    sendCommand: () => Promise.resolve({}),
    setAgentFileRoots: noop,
    sleepGuest: (targetId) => {
      slept.push(targetId);
      asleep.add(targetId);
    },
    stopScreencast: noop,
    subscribeEvents: () => noop,
  };
  return {
    asleep,
    browser,
    busy,
    closed,
    slept,
    /** The guest goes on its own: its tab closed, or its renderer crashed. */
    destroy: (targetId: BrowserTargetId) => destroyed.get(targetId)?.(),
  };
}

let clock = 0;
let driven = new Set<BrowserTargetId>();

function start() {
  const browser = makeBrowser();
  const actor = createActor(windowBrowserLogic, {
    input: {
      browser: browser.browser,
      isDrivenByWorkingAgent: (targetId) =>
        Promise.resolve(driven.has(targetId)),
      now: () => clock,
    },
  }).start();
  const send = (
    type: "acquireVisible" | "registerTarget" | "releaseVisible",
    targetId: BrowserTargetId,
  ) => {
    actor.send({ type, value: { targetId } });
  };
  return { ...browser, actor, send };
}

/** Lets time pass, the way both clocks see it, with every check it brings. */
async function pass(duration: number) {
  clock += duration;
  await vi.advanceTimersByTimeAsync(duration);
}

const tab = () => browserTargetOf(StoreId.newSessionId());

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  driven = new Set();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("windowBrowserLogic", () => {
  it("keeps a page for as long as it is drawn", async () => {
    const { closed, send } = start();
    const page = tab();
    send("acquireVisible", page);
    send("registerTarget", page);

    await pass(SEEN_TAB_DISCARD_MS * 3);

    expect(closed).toEqual([]);
  });

  it("discards a page the person saw once it has been off screen for the seen clock", async () => {
    const { closed, send } = start();
    const page = tab();
    send("acquireVisible", page);
    send("registerTarget", page);
    send("releaseVisible", page);

    await pass(SEEN_TAB_DISCARD_MS - DISCARD_CHECK_MS);
    expect(closed).toEqual([]);

    await pass(DISCARD_CHECK_MS);
    expect(closed).toEqual([page]);
  });

  it("discards a page only an agent opened, never shown, on the shorter clock", async () => {
    const { closed, send } = start();
    const page = tab();
    send("registerTarget", page);

    await pass(UNSEEN_TAB_DISCARD_MS);

    expect(closed).toEqual([page]);
  });

  it("counts the clock from when the page last left the screen", async () => {
    const { closed, send } = start();
    const page = tab();
    send("registerTarget", page);
    await pass(UNSEEN_TAB_DISCARD_MS / 2);
    send("acquireVisible", page);
    send("releaseVisible", page);

    // Seen now, so the long clock, from the moment it was hidden again.
    await pass(UNSEEN_TAB_DISCARD_MS);
    expect(closed).toEqual([]);
    await pass(SEEN_TAB_DISCARD_MS - UNSEEN_TAB_DISCARD_MS);
    expect(closed).toEqual([page]);
  });

  it("keeps a page drawn in two places while one of them is left", async () => {
    const { closed, send } = start();
    const page = tab();
    send("registerTarget", page);
    send("acquireVisible", page);
    send("acquireVisible", page);
    send("releaseVisible", page);

    await pass(SEEN_TAB_DISCARD_MS * 2);

    expect(closed).toEqual([]);
  });

  it("keeps a page an agent sent a command to in the last ten minutes", async () => {
    const { closed, send } = start();
    const page = tab();
    send("registerTarget", page);
    await pass(UNSEEN_TAB_DISCARD_MS - AGENT_PROTECTION_MS / 2);
    noteBrowserAgentActivity(page);

    await pass(AGENT_PROTECTION_MS / 2);
    expect(closed).toEqual([]);

    await pass(AGENT_PROTECTION_MS);
    expect(closed).toEqual([page]);
  });

  it("keeps a page a working agent drives, and lets it go once the agent is done", async () => {
    const { closed, send } = start();
    const page = tab();
    driven.add(page);
    send("registerTarget", page);

    await pass(SEEN_TAB_DISCARD_MS);
    expect(closed).toEqual([]);

    driven.delete(page);
    await pass(DISCARD_CHECK_MS);
    expect(closed).toEqual([page]);
  });

  it("keeps a page whose guest is busy", async () => {
    const { busy, closed, send } = start();
    const page = tab();
    busy.add(page);
    send("registerTarget", page);

    await pass(SEEN_TAB_DISCARD_MS);
    expect(closed).toEqual([]);

    busy.delete(page);
    await pass(DISCARD_CHECK_MS);
    expect(closed).toEqual([page]);
  });

  it("discards only the pages whose clocks ran out", async () => {
    const { closed, send } = start();
    const old = tab();
    const shown = tab();
    send("registerTarget", old);
    send("acquireVisible", shown);
    send("registerTarget", shown);

    await pass(UNSEEN_TAB_DISCARD_MS);

    expect(closed).toEqual([old]);
  });

  it("keeps a page still drawn when its guest goes and comes back", async () => {
    const { closed, destroy, send } = start();
    const page = tab();
    send("acquireVisible", page);
    send("registerTarget", page);
    destroy(page);
    send("registerTarget", page);

    await pass(SEEN_TAB_DISCARD_MS * 2);

    expect(closed).toEqual([]);
  });

  it("asks for a discard once, however long the guest takes to go", async () => {
    const { browser, closed, send } = start();
    browser.closeTarget = (targetId) => {
      closed.push(targetId);
      return Promise.resolve();
    };
    const page = tab();
    send("registerTarget", page);

    await pass(UNSEEN_TAB_DISCARD_MS + DISCARD_CHECK_MS * 3);

    expect(closed).toEqual([page]);
  });

  describe("sleep", () => {
    it("puts a page to sleep once it has been off screen for a while", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS - SLEEP_CHECK_MS);
      expect(slept).toEqual([]);

      await pass(SLEEP_CHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("never puts a drawn page to sleep", async () => {
      const { send, slept } = start();
      const page = tab();
      send("acquireVisible", page);
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS * 10);

      expect(slept).toEqual([]);
    });

    it("counts from when the page last left the screen", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(SLEEP_AFTER_MS - SLEEP_CHECK_MS);
      send("acquireVisible", page);
      send("releaseVisible", page);

      await pass(SLEEP_AFTER_MS - SLEEP_CHECK_MS);
      expect(slept).toEqual([]);
      await pass(SLEEP_CHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("keeps a page awake while a working agent drives it", async () => {
      const { send, slept } = start();
      const page = tab();
      driven.add(page);
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS * 10);
      expect(slept).toEqual([]);

      driven.delete(page);
      await pass(SLEEP_CHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("keeps a page awake for a while after an agent's command", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(SLEEP_AFTER_MS - SLEEP_CHECK_MS);
      noteBrowserAgentActivity(page);

      await pass(SLEEP_AFTER_MS - SLEEP_CHECK_MS);
      expect(slept).toEqual([]);
      await pass(SLEEP_CHECK_MS * 2);
      expect(slept).toEqual([page]);
    });

    it("keeps a busy page awake", async () => {
      const { busy, send, slept } = start();
      const page = tab();
      busy.add(page);
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS * 10);
      expect(slept).toEqual([]);

      busy.delete(page);
      await pass(SLEEP_CHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("asks once while the page stays asleep, and again once it was woken", async () => {
      const { asleep, send, slept } = start();
      const page = tab();
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS * 3);
      expect(slept).toEqual([page]);

      // A command or a slot showing it woke it, out of this actor's sight.
      asleep.delete(page);
      await pass(SLEEP_CHECK_MS);
      expect(slept).toEqual([page, page]);
    });
  });
});
