import ms from "ms";
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
import { MEMORY_PROTECTION_MS, type MemoryLevel } from "./page-lifetime";
import {
  AGENT_PROTECTION_MS,
  DISCARD_CHECK_MS,
  MEMORY_RECHECK_MS,
  SEEN_TAB_DISCARD_MS,
  DRIVEN_SLEEP_AFTER_MS,
  SLEEP_AFTER_MS,
  SLEEP_RECHECK_MS,
  tabLifetime,
  UNSEEN_TAB_DISCARD_MS,
  windowBrowserLogic,
} from "./window-browser";

/** A browser whose guests live until closed, with the closes and sleeps it was asked for. */
function makeBrowser() {
  const destroyed = new Map<BrowserTargetId, () => void>();
  const busy = new Set<BrowserTargetId>();
  const closed: BrowserTargetId[] = [];
  const asleep = new Set<BrowserTargetId>();
  const edited = new Set<BrowserTargetId>();
  const slept: BrowserTargetId[] = [];
  const browser: BrowserConfig = {
    closeTarget: () => Promise.resolve(),
    discardTarget: (targetId) => {
      closed.push(targetId);
      destroyed.get(targetId)?.();
      return Promise.resolve();
    },
    contentBlocking: () => ({ task: true, workspace: true }),
    createTarget: () => Promise.resolve(),
    getTargetMeta: () => null,
    getTargetAddress: () => undefined,
    getLoadedDocumentUrl: () => undefined,
    hasNoWindow: false,
    guestCost: () => null,
    isGuestAsleep: (targetId) => asleep.has(targetId),
    personInputAt: () => undefined,
    isGuestBusy: (targetId) => busy.has(targetId),
    isGuestEdited: (targetId) => edited.has(targetId),
    listTargets: () => Promise.resolve([]),
    loadPage: () => Promise.resolve(),
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
    edited,
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

const tab = () => browserTargetOf(StoreId.newTabId());

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  driven = new Set();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it("keeps a page a person entered something into, asleep, until it loads another document", async () => {
    const { closed, edited, send, slept } = start();
    const page = tab();
    send("acquireVisible", page);
    send("registerTarget", page);
    edited.add(page);
    send("releaseVisible", page);

    await pass(SEEN_TAB_DISCARD_MS * 3);
    expect(closed).toEqual([]);
    expect(slept).toContain(page);
    expect(tabLifetime(page)?.unloadsInMs).toBeNull();

    edited.delete(page);
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
    browser.discardTarget = (targetId) => {
      closed.push(targetId);
      return Promise.resolve();
    };
    const page = tab();
    send("registerTarget", page);

    await pass(UNSEEN_TAB_DISCARD_MS + DISCARD_CHECK_MS * 3);

    expect(closed).toEqual([page]);
  });

  describe("sleep", () => {
    it("puts a page to sleep once it has been off screen for a few seconds", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS - 1);
      expect(slept).toEqual([]);

      await pass(1);
      expect(slept).toEqual([page]);
    });

    it("never puts a drawn page to sleep", async () => {
      const { send, slept } = start();
      const page = tab();
      send("acquireVisible", page);
      send("registerTarget", page);

      await pass(DRIVEN_SLEEP_AFTER_MS * 2);

      expect(slept).toEqual([]);
    });

    it("counts from when the page last left the screen", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(SLEEP_AFTER_MS - 1);
      send("acquireVisible", page);
      await pass(SLEEP_AFTER_MS * 4);
      send("releaseVisible", page);

      await pass(SLEEP_AFTER_MS - 1);
      expect(slept).toEqual([]);
      await pass(1);
      expect(slept).toEqual([page]);
    });

    it("counts from an agent's last command when that came later", async () => {
      const { send, slept } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(SLEEP_AFTER_MS - 1);
      noteBrowserAgentActivity(page);

      await pass(SLEEP_AFTER_MS - 1);
      expect(slept).toEqual([]);
      await pass(1);
      expect(slept).toEqual([page]);
    });

    it("lets a working agent's tab sleep only once the agent has left it alone for minutes", async () => {
      const { send, slept } = start();
      const page = tab();
      driven.add(page);
      send("registerTarget", page);
      noteBrowserAgentActivity(page);

      await pass(DRIVEN_SLEEP_AFTER_MS - SLEEP_RECHECK_MS);
      expect(slept).toEqual([]);

      await pass(SLEEP_RECHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("keeps a working agent's tab awake while it sends commands", async () => {
      const { send, slept } = start();
      const page = tab();
      driven.add(page);
      send("registerTarget", page);
      for (let minute = 0; minute < 5; minute += 1) {
        noteBrowserAgentActivity(page);
        await pass(DRIVEN_SLEEP_AFTER_MS / 2);
      }
      expect(slept).toEqual([]);

      // The turn ends: the short wait applies again.
      driven.delete(page);
      await pass(SLEEP_RECHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("keeps a busy page awake", async () => {
      const { busy, send, slept } = start();
      const page = tab();
      busy.add(page);
      send("registerTarget", page);

      await pass(DRIVEN_SLEEP_AFTER_MS * 2);
      expect(slept).toEqual([]);

      busy.delete(page);
      await pass(SLEEP_RECHECK_MS);
      expect(slept).toEqual([page]);
    });

    it("asks once while the page stays asleep, and again once it was woken", async () => {
      const { asleep, send, slept } = start();
      const page = tab();
      send("registerTarget", page);

      await pass(SLEEP_AFTER_MS + SLEEP_RECHECK_MS * 3);
      expect(slept).toEqual([page]);

      // The window showed it and hid it again: it slept once more.
      asleep.delete(page);
      await pass(SLEEP_RECHECK_MS);
      expect(slept).toEqual([page, page]);
    });

    it("puts a page woken by a command back to sleep once it is quiet again", async () => {
      const { asleep, send, slept } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(SLEEP_AFTER_MS);
      expect(slept).toEqual([page]);

      asleep.delete(page);
      noteBrowserAgentActivity(page);
      await pass(SLEEP_AFTER_MS - 1);
      expect(slept).toEqual([page]);
      await pass(1);
      expect(slept).toEqual([page, page]);
    });
  });

  describe("tabLifetime", () => {
    it("says how long a hidden page has before it is unloaded", async () => {
      const { send } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(ms("5 minutes"));

      expect(tabLifetime(page)).toEqual({
        drawn: false,
        hiddenForMs: ms("5 minutes"),
        unloadsInMs: UNSEEN_TAB_DISCARD_MS - ms("5 minutes"),
      });
    });

    it("counts an agent's recent command as protection", async () => {
      const { send } = start();
      const page = tab();
      send("registerTarget", page);
      await pass(UNSEEN_TAB_DISCARD_MS - ms("1 minute"));
      noteBrowserAgentActivity(page);

      expect(tabLifetime(page)?.unloadsInMs).toBe(AGENT_PROTECTION_MS);
    });

    it("says a drawn page is drawn", () => {
      const { send } = start();
      const page = tab();
      send("acquireVisible", page);
      send("registerTarget", page);

      expect(tabLifetime(page)).toEqual({
        drawn: true,
        hiddenForMs: null,
        unloadsInMs: null,
      });
    });
  });
});

describe("memory pressure", () => {
  it("closes pages out of sight while memory is short, the one hidden longest first", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      lines.push(line);
    });
    let level: MemoryLevel = "normal";
    const { browser, closed, edited } = makeBrowser();
    browser.memoryLevel = () => Promise.resolve(level);
    // Main refuses this one page sleep, as it does a page in full screen.
    const awake = tab();
    const sleepGuest = browser.sleepGuest;
    browser.sleepGuest = (targetId) => {
      if (targetId !== awake) {
        sleepGuest(targetId);
      }
    };
    const actor = createActor(windowBrowserLogic, {
      input: {
        browser,
        isDrivenByWorkingAgent: () => Promise.resolve(false),
        now: () => clock,
      },
    }).start();
    const send = (
      type: "acquireVisible" | "registerTarget" | "releaseVisible",
      targetId: BrowserTargetId,
    ) => {
      actor.send({ type, value: { targetId } });
    };
    const names = new Map<BrowserTargetId, string>();
    const seenThenHidden = (name: string, page = tab()) => {
      names.set(page, name);
      send("acquireVisible", page);
      send("registerTarget", page);
      send("releaseVisible", page);
      return page;
    };
    const closedNames = () => closed.map((page) => names.get(page));

    const oldest = seenThenHidden("oldest");
    await pass(ms("10 minutes"));
    seenThenHidden("older");
    await pass(ms("10 minutes"));
    seenThenHidden("awake", awake);
    edited.add(seenThenHidden("typed in"));
    const drawn = tab();
    names.set(drawn, "drawn");
    send("acquireVisible", drawn);
    send("registerTarget", drawn);
    await pass(ms("5 minutes"));
    expect(closedNames()).toEqual([]);

    // Low closes nothing, as in Chromium.
    level = "low";
    await pass(DISCARD_CHECK_MS + MEMORY_RECHECK_MS * 3);
    expect(closedNames()).toEqual([]);

    // Critical: one page out of sight 10 min or more each reading, awake or
    // asleep, until none is left that nothing keeps.
    level = "critical";
    await pass(MEMORY_RECHECK_MS);
    expect(closedNames()).toEqual(["oldest"]);
    await pass(MEMORY_RECHECK_MS);
    expect(closedNames()).toEqual(["oldest", "older"]);
    await pass(MEMORY_RECHECK_MS * 3);
    expect(closedNames()).toEqual(["oldest", "older"]);

    // Shown again, the oldest comes back with a fresh guest, drawn.
    send("acquireVisible", oldest);
    send("registerTarget", oldest);

    // The page still awake goes once it has been out of sight 10 min.
    await pass(ms("4 minutes"));
    expect(closedNames()).toEqual(["oldest", "older", "awake"]);

    level = "normal";
    await pass(MEMORY_RECHECK_MS + DISCARD_CHECK_MS * 3);
    expect(closedNames()).toEqual(["oldest", "older", "awake"]);

    expect(
      lines.map((line) =>
        line.replace(/targetId=(\S+)/, (_, id: BrowserTargetId) => `page=${names.get(id)}`),
      ),
    ).toMatchInlineSnapshot(`
      [
        "memory pressure normal -> low",
        "memory pressure low -> critical",
        "page closed for memory page=oldest level=critical state=asleep hiddenFor=1580s",
        "page closed for memory page=older level=critical state=asleep hiddenFor=985s",
        "page closed for memory page=awake level=critical state=hidden hiddenFor=640s",
        "memory pressure critical -> normal",
      ]
    `);
    actor.stop();
  });

  it("keeps the last level through a reading that fails", async () => {
    vi.spyOn(console, "info").mockImplementation(noop);
    vi.spyOn(console, "warn").mockImplementation(noop);
    // One reading a minute while normal, so the critical one comes at 10 min.
    const readings: (MemoryLevel | Error)[] = [
      ...Array.from({ length: 9 }, (): MemoryLevel => "normal"),
      "critical",
      new Error("no sysctl"),
    ];
    const { browser, closed } = makeBrowser();
    browser.memoryLevel = () => {
      const next = readings.shift() ?? "normal";
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    const actor = createActor(windowBrowserLogic, {
      input: {
        browser,
        isDrivenByWorkingAgent: () => Promise.resolve(false),
        now: () => clock,
      },
    }).start();
    const first = tab();
    const second = tab();
    actor.send({ type: "registerTarget", value: { targetId: first } });
    await pass(ms("1 second"));
    actor.send({ type: "registerTarget", value: { targetId: second } });
    await pass(MEMORY_PROTECTION_MS - ms("1 second"));
    expect(closed).toEqual([first]);

    await pass(MEMORY_RECHECK_MS);
    expect(closed).toEqual([first, second]);
    actor.stop();
  });
});
