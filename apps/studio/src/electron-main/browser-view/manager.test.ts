import { browserPartition } from "@/shared/browser";
import {
  type AbsolutePath,
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
        shown: false,
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

    it("leaves a guest where an agent is at work in it", async () => {
      hostWith(601);
      hostWith(602);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 601 })
        .catch(() => undefined);
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

      vi.advanceTimersByTime(30_001);
      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 602,
        })
        .catch(() => undefined);
      expect(idsIn(602)).toContain(targetId);
    });

    it("lets a released guest go to the next window that shows it", () => {
      hostWith(501);
      hostWith(502);
      const manager = getBrowserViewManager();
      const targetId = browserTargetOf(StoreId.newTabId());
      void manager.browser
        .createTarget(targetId, partition, { webContentsId: 501 })
        .catch(() => undefined);
      manager.setGuestShown(targetId, true);
      manager.releaseGuest(targetId);

      void manager.browser
        .createTarget(targetId, partition, {
          take: "parked",
          webContentsId: 502,
        })
        .catch(() => undefined);
      expect(idsIn(502)).toContain(targetId);
    });
  });
});
