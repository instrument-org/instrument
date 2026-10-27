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
});
