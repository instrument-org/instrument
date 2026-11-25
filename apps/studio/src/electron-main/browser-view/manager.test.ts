import { browserPartition } from "@/shared/browser";
import {
  type AbsolutePath,
  type BrowserTargetId,
  browserTargetOf,
  StoreId,
} from "@instrument-org/workspace/electron";
import { type WebContents } from "electron";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrowserViewManager } from "./manager";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("./guest-session", () => ({ configureGuestSession: vi.fn() }));
vi.mock("./extensions", () => ({
  registerExtensionTab: () => () => {},
  selectExtensionTab: vi.fn(),
}));
vi.mock("../page-editor/sessions", () => ({
  pageEditorPreloadPath: () => "/preload.js",
}));
vi.mock("../windows/on-screen", () => ({ isDrivenInstance: () => false }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getBrowserViewManager", () => {
  // A first launch opens the window during setup, before any workspace has
  // started; the workspace setup starts must still find its guests hosted.
  it("hosts the workspace's guests in a window bound before the workspace started", () => {
    const host = new EventEmitter();
    getBrowserViewManager().bindHost(host as unknown as WebContents);

    const targetId = browserTargetOf(StoreId.newTabId());
    const { browser } = getBrowserViewManager();
    browser
      .createTarget(targetId, "/tmp/partition" as AbsolutePath)
      .catch(() => undefined);

    const preventDefault = vi.fn();
    const accepted = host.emit(
      "will-attach-webview",
      { preventDefault },
      {},
      { partition: browserPartition(targetId) },
    );

    expect(accepted).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  describe("with more than one window", () => {
    const partition = "/tmp/partition" as AbsolutePath;
    const hostWith = (id: number) => {
      const host = Object.assign(new EventEmitter(), { id });
      getBrowserViewManager().bindHost(host as unknown as WebContents);
      return host;
    };
    const idsIn = (id: number) =>
      getBrowserViewManager()
        .getTargets(id)
        .map((target) => target.id);
    // A guest as far as attaching one goes, which asks a lot of it and uses little.
    const answersAnything = (): unknown =>
      new Proxy(() => undefined, {
        apply: () => answersAnything(),
        get: (_target, key) => (key === "then" ? undefined : answersAnything()),
      });
    const attachGuest = (
      host: EventEmitter,
      targetId: BrowserTargetId,
      guestId: number,
      {
        entries = [],
        index = 0,
      }: { entries?: { title: string; url: string }[]; index?: number } = {},
    ) => {
      const restore = vi.fn(() => Promise.resolve());
      const params = {
        partition: browserPartition(targetId),
        src: "about:blank",
      };
      host.emit("will-attach-webview", { preventDefault: vi.fn() }, {}, params);
      const guest = new Proxy(
        Object.assign(new EventEmitter(), {
          id: guestId,
          isDestroyed: () => false,
          navigationHistory: {
            getActiveIndex: () => index,
            getAllEntries: () => entries,
            length: () => entries.length,
            restore,
          },
        }),
        {
          get: (target, key, receiver): unknown =>
            key in target
              ? Reflect.get(target, key, receiver)
              : answersAnything(),
        },
      );
      host.emit("did-attach-webview", {}, guest);
      return { params, restore };
    };

    it("mounts a guest only in the window that asked for it", () => {
      hostWith(101);
      hostWith(102);
      const targetId = browserTargetOf(StoreId.newTabId());
      void getBrowserViewManager()
        .browser.createTarget(targetId, partition, { webContentsId: 101 })
        .catch(() => undefined);

      expect(idsIn(101)).toContain(targetId);
      expect(idsIn(102)).not.toContain(targetId);
      expect(getBrowserViewManager().isHostOf(101, targetId)).toBe(true);
      expect(getBrowserViewManager().isHostOf(102, targetId)).toBe(false);
      expect(getBrowserViewManager().getTargetsElsewhere(102)).toContainEqual({
        canTake: true,
        isInUse: false,
        targetId,
      });
    });

    it("gives a guest nothing asked for to the window bound last", () => {
      hostWith(201);
      hostWith(202);
      const targetId = browserTargetOf(StoreId.newTabId());
      void getBrowserViewManager()
        .browser.createTarget(targetId, partition)
        .catch(() => undefined);

      expect(idsIn(202)).toContain(targetId);
      expect(idsIn(201)).not.toContain(targetId);
    });

    it("leaves a parked guest alone for a spare window showing it, until the spare is a window", () => {
      hostWith(701);
      let isSpare = true;
      const spare = Object.assign(new EventEmitter(), { id: 702 });
      const manager = getBrowserViewManager();
      manager.bindHost(spare as unknown as WebContents, {
        isSpare: () => isSpare,
      });
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 701 })
        .catch(() => undefined);
      const askedByTheSpare = () =>
        void manager.browser
          .createTarget(targetId, partition, {
            take: "parked",
            webContentsId: 702,
          })
          .catch(() => undefined);

      const canTake = () =>
        manager
          .getTargetsElsewhere(702)
          .find((each) => each.targetId === targetId)?.canTake;

      askedByTheSpare();
      expect(idsIn(701)).toContain(targetId);
      expect(canTake()).toBe(false);

      isSpare = false;
      expect(canTake()).toBe(true);
      askedByTheSpare();
      expect(idsIn(702)).toContain(targetId);
    });

    it("hands a closing window's pages on before it has gone, so none goes with it", () => {
      const leaving = hostWith(901);
      hostWith(902);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 901 })
        .catch(() => undefined);
      attachGuest(leaving, targetId, 9001);
      const generation = manager.getTargets(901)[0]?.generation;

      manager.handOffGuestsOf(901, 902, [targetId]);
      expect(idsIn(901)).toContain(targetId);
      expect(idsIn(902)).not.toContain(targetId);

      manager.handOffGuestsOf(901, 902, []);
      expect(idsIn(902)).toContain(targetId);
      expect(idsIn(901)).not.toContain(targetId);
      expect(manager.getTargets(902)[0]?.generation).not.toBe(generation);
    });

    it("sends a guest nothing asked for to a window, never a spare, even as the window in front goes", () => {
      const window = hostWith(801);
      const spare = Object.assign(new EventEmitter(), { id: 802 });
      const front = hostWith(803);
      const manager = getBrowserViewManager();
      manager.bindHost(spare as unknown as WebContents, {
        isSpare: () => true,
      });

      const before = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(before, partition)
        .catch(() => undefined);
      expect(idsIn(803)).toContain(before);

      front.emit("destroyed");
      const after = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(after, partition)
        .catch(() => undefined);
      expect(idsIn(801)).toContain(after);
      expect(idsIn(802)).not.toContain(after);
      window.emit("destroyed");
    });

    const visited = {
      entries: [
        "https://a.example/",
        "https://b.example/",
        "https://c.example/",
      ].map((url) => ({ title: url, url })),
      index: 1,
    };
    const A_AND_B = ["https://a.example/", "https://b.example/"];
    const reopened = async (
      { goes, restoreUrl }: { goes: "close" | "discard"; restoreUrl?: string },
      hostId: number,
    ) => {
      const host = hostWith(hostId);
      const { browser, getTargets } = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      const open = (url?: string) =>
        void browser
          .createTarget(targetId, partition, { webContentsId: hostId }, url)
          .catch(() => undefined);
      open();
      attachGuest(host, targetId, hostId * 10, visited);
      await (goes === "close"
        ? browser.closeTarget(targetId)
        : browser.discardTarget(targetId));
      open(restoreUrl);
      const src = getTargets(hostId).find(({ id }) => id === targetId)?.src;
      const { restore } = attachGuest(host, targetId, hostId * 10 + 1);
      return { restored: restore.mock.calls, src };
    };

    it("brings a discarded tab back on its page, over the pages behind it", async () => {
      expect(
        await reopened({ goes: "discard", restoreUrl: A_AND_B[1] }, 311),
      ).toEqual({
        restored: [[{ entries: [visited.entries[0]], index: 0 }]],
        src: A_AND_B[1],
      });
    });

    it.each([
      [
        "sent elsewhere since",
        312,
        { goes: "discard", restoreUrl: "https://d.example/" },
      ],
      ["opened at an address of its own", 313, { goes: "discard" }],
      ["closed", 314, { goes: "close", restoreUrl: A_AND_B[1] }],
    ] as const)(
      "brings no history back for a tab %s",
      async (_, hostId, how) => {
        expect(await reopened(how, hostId)).toEqual({
          restored: [],
          src: undefined,
        });
      },
    );

    it("gives a page a tab steps back to the history it left with, whole", async () => {
      const host = hostWith(321);
      const manager = getBrowserViewManager();
      const [targetId, as] = [StoreId.newTabId(), StoreId.newTabId()].map(
        (id) => browserTargetOf(id),
      );
      if (!targetId || !as) {
        throw new Error("no targets");
      }
      const open = (id: typeof targetId, url?: string) =>
        void manager.browser
          .createTarget(id, partition, { webContentsId: 321 }, url)
          .catch(() => undefined);
      open(targetId);
      attachGuest(host, targetId, 3210, visited);
      const url = "https://b.example/";
      await manager.keepHistoryFor({ as, leaving: false, targetId, url });
      open(as, url);
      const { params, restore } = attachGuest(host, as, 3211);
      expect(restore.mock.calls).toEqual([
        [{ entries: visited.entries.slice(0, 2), index: 1 }],
      ]);
      // An address of the element's own would load over the history.
      expect(params).not.toHaveProperty("src");
    });

    it("moves a parked guest to the window showing it, as a new guest", () => {
      hostWith(301);
      hostWith(302);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 301 })
        .catch(() => undefined);
      const generation = manager.getTargets(301)[0]?.generation;

      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 302,
        })
        .catch(() => undefined);

      expect(idsIn(301)).not.toContain(targetId);
      const moved = manager.getTargets(302).find(({ id }) => id === targetId);
      expect(moved?.generation).not.toBe(generation);
    });

    it("leaves a guest where a window is showing it until asked outright, and claims it as it moves", () => {
      hostWith(401);
      hostWith(402);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 401 })
        .catch(() => undefined);
      manager.setGuestShown(targetId, true);

      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 402,
        })
        .catch(() => undefined);
      expect(idsIn(401)).toContain(targetId);

      void manager.browser
        .createTarget(targetId, partition, {
          take: "always",
          webContentsId: 402,
        })
        .catch(() => undefined);
      expect(idsIn(402)).toContain(targetId);

      // The window it left, still showing the tab, must not take it straight
      // back before the window it went to has reported showing it.
      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 401,
        })
        .catch(() => undefined);
      expect(idsIn(402)).toContain(targetId);
      expect(idsIn(401)).not.toContain(targetId);
    });

    it("leaves a guest an agent has used where it is, until a window asks for it", async () => {
      const having = hostWith(601);
      hostWith(602);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 601 })
        .catch(() => undefined);
      attachGuest(having, targetId, 6001);
      await manager.browser
        .sendCommand(targetId, "Input.dispatchMouseEvent", {})
        .catch(() => undefined);

      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 602,
        })
        .catch(() => undefined);
      expect(idsIn(601)).toContain(targetId);

      // Long after its last command, what the agent did there is still there.
      vi.advanceTimersByTime(30_001);
      console.log(
        "DBG used2",
        manager.isPageUsed([targetId]),
        manager.getTargetsElsewhere(602),
      );
      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 602,
        })
        .catch(() => undefined);
      expect(idsIn(601)).toContain(targetId);
      expect(manager.getTargetsElsewhere(602)).toContainEqual({
        canTake: false,
        isInUse: true,
        targetId,
      });

      void manager.browser
        .createTarget(targetId, partition, {
          take: "always",
          webContentsId: 602,
        })
        .catch(() => undefined);
      expect(idsIn(602)).toContain(targetId);
    });

    it("counts a page as used once an agent has clicked or typed in it, and not for being sent to an address", async () => {
      hostWith(701);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 701 })
        .catch(() => undefined);

      await manager.browser
        .sendCommand(targetId, "Page.navigate", { url: "https://example.com" })
        .catch(() => undefined);
      expect(manager.isPageUsed([targetId])).toBe(false);

      await manager.browser
        .sendCommand(targetId, "Input.dispatchMouseEvent", {})
        .catch(() => undefined);
      expect(manager.isPageUsed([targetId])).toBe(true);
    });

    it("goes on being watched when it is handed to another window, since the page goes on", async () => {
      hostWith(601);
      hostWith(602);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 601 })
        .catch(() => undefined);
      const gone = vi.fn();
      manager.browser.onTargetDestroyed(targetId, gone);

      void manager.handOffGuest(targetId, 602);
      await vi.advanceTimersByTimeAsync(0);
      expect(gone).not.toHaveBeenCalled();

      void manager.browser.closeTarget(targetId).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(gone).toHaveBeenCalledTimes(1);
    });

    it("sends nothing to a page as it closes, so what its watchers send as they hear it go wakes nothing", async () => {
      const host = hostWith(621);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 621 })
        .catch(() => undefined);
      attachGuest(host, targetId, 6201);
      const sent: Promise<unknown>[] = [];
      manager.browser.onTargetDestroyed(targetId, () => {
        sent.push(manager.browser.sendCommand(targetId, "Fetch.disable", {}));
      });

      await manager.browser.closeTarget(targetId);

      expect(sent).toHaveLength(1);
      await expect(sent[0]).rejects.toThrow("Browser target closing");
    });

    it("tells an agent watching a page that it closed when it is handed to another window, so it attaches to the new one", async () => {
      hostWith(611);
      hostWith(612);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 611 })
        .catch(() => undefined);
      const detached = vi.fn();
      const events = vi.fn();
      manager.browser.subscribeEvents(targetId, detached, events);

      void manager.handOffGuest(targetId, 612);
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.isHostOf(612, targetId)).toBe(true);
      expect(detached).toHaveBeenCalledTimes(1);
    });

    it("hands a guest to another window even while its own shows it", async () => {
      hostWith(501);
      hostWith(502);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 501 })
        .catch(() => undefined);
      manager.setGuestShown(targetId, true);

      void manager.handOffGuest(targetId, 502);
      await vi.advanceTimersByTimeAsync(0);

      expect(idsIn(502)).toContain(targetId);
      expect(idsIn(501)).not.toContain(targetId);
      // The window it left is told nothing of it to show, so nothing can ask to
      // have it shown there instead.
      expect(manager.isHostOf(501, targetId)).toBe(false);
      expect(manager.isHostOf(502, targetId)).toBe(true);
    });
  });
});
