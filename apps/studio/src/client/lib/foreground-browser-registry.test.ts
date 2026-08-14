import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerForegroundBrowser,
  requestBrowserFind,
  requestBrowserReload,
} from "./foreground-browser-registry";

const { getWebviewElement } = vi.hoisted(() => ({
  getWebviewElement: vi.fn(),
}));

vi.mock("@/client/lib/browser-pool", () => ({ getWebviewElement }));

const TARGET_ID = "task_1/session_1" as BrowserTargetId;

function mountWebview(reload = vi.fn()) {
  getWebviewElement.mockReturnValue({ reload });
  return reload;
}

beforeEach(() => {
  vi.clearAllMocks();
  getWebviewElement.mockReturnValue(null);
});

describe("with no foreground browser", () => {
  it("reports both chords unhandled, so the app takes them", () => {
    mountWebview();
    expect(requestBrowserFind()).toBe(false);
    expect(requestBrowserReload()).toBe(false);
  });
});

describe("with a foreground browser", () => {
  it("opens that panel's find bar", () => {
    const openFind = vi.fn();
    const unregister = registerForegroundBrowser({
      openFind,
      targetId: TARGET_ID,
    });

    expect(requestBrowserFind()).toBe(true);
    expect(openFind).toHaveBeenCalledOnce();

    unregister();
    expect(requestBrowserFind()).toBe(false);
  });

  it("reloads its guest rather than the app", () => {
    const reload = mountWebview();
    const unregister = registerForegroundBrowser({
      openFind: vi.fn(),
      targetId: TARGET_ID,
    });

    expect(requestBrowserReload()).toBe(true);
    expect(getWebviewElement).toHaveBeenCalledWith(TARGET_ID);
    expect(reload).toHaveBeenCalledOnce();

    unregister();
    expect(requestBrowserReload()).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("falls back to the app when the guest is gone or not yet attached", () => {
    registerForegroundBrowser({ openFind: vi.fn(), targetId: TARGET_ID });

    getWebviewElement.mockReturnValue(null);
    expect(requestBrowserReload()).toBe(false);

    getWebviewElement.mockReturnValue({
      reload: () => {
        throw new Error("The WebView must be attached to the DOM");
      },
    });
    expect(requestBrowserReload()).toBe(false);
  });

  it("keeps the newly-registered panel when the outgoing one unregisters late", () => {
    const outgoing = vi.fn();
    const unregisterOutgoing = registerForegroundBrowser({
      openFind: outgoing,
      targetId: TARGET_ID,
    });
    const incoming = vi.fn();
    registerForegroundBrowser({ openFind: incoming, targetId: TARGET_ID });
    unregisterOutgoing();

    expect(requestBrowserFind()).toBe(true);
    expect(incoming).toHaveBeenCalledOnce();
    expect(outgoing).not.toHaveBeenCalled();
  });
});
