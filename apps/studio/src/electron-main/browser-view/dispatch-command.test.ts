import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendCommand } from "./dispatch-command";
import { type BrowserEntry, createEntry } from "./entry";
import {
  clearGuestSurface,
  getDesiredGuestSurfaces,
  recordEffectiveGuestSurface,
  setRasterBudget,
} from "./guest-surface";

const SUBDOMAIN = TaskIdSchema.parse("agent-browser-test");
const SESSION_ID = StoreId.newSessionId();
const TARGET_ID = encodeBrowserTargetId(SUBDOMAIN, SESSION_ID);

interface FakeDebugger {
  isAttached: () => boolean;
  sendCommand: ReturnType<typeof vi.fn>;
}

interface FakeWebContents {
  capturePage?: ReturnType<typeof vi.fn>;
  debugger: FakeDebugger;
  executeJavaScript: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  printToPDF?: ReturnType<typeof vi.fn>;
}

function makeEntry({
  attached = true,
  capturePage,
  destroyed = false,
  // Guests hold keyboard focus in most of these tests; the focus gate has its
  // own cases below.
  hasFocus = true,
  printToPDF,
  sendCommand: wcSendCommand = vi.fn(),
  targetId = TARGET_ID,
  webContents = true,
}: {
  attached?: boolean;
  capturePage?: ReturnType<typeof vi.fn>;
  destroyed?: boolean;
  hasFocus?: boolean | Promise<unknown>;
  printToPDF?: ReturnType<typeof vi.fn>;
  sendCommand?: ReturnType<typeof vi.fn>;
  targetId?: BrowserTargetId;
  webContents?: boolean;
} = {}): BrowserEntry {
  const wc: FakeWebContents | null = webContents
    ? {
        capturePage,
        debugger: {
          isAttached: () => attached,
          sendCommand: wcSendCommand,
        },
        executeJavaScript: vi
          .fn()
          .mockImplementation(() =>
            hasFocus instanceof Promise ? hasFocus : Promise.resolve(hasFocus),
          ),
        isDestroyed: () => destroyed,
        printToPDF,
      }
    : null;
  const entry = createEntry({
    id: SUBDOMAIN,
    partitionDir: "/tmp/partition" as AbsolutePath,
    sessionId: SESSION_ID,
    targetId,
  });
  // Cast to the WebContents type while exposing only the surface sendCommand
  // actually touches (entry.webContents).
  entry.webContents = wc as unknown as null | WebContents;
  return entry;
}

describe("sendCommand", () => {
  it("throws when target is not registered", async () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    await expect(
      sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.enable",
        params: undefined,
        targetId: "missing/x" as BrowserTargetId,
      }),
    ).rejects.toThrow("Browser target not found: missing/x");
  });

  it("acknowledges Page.screencastFrameAck locally without hitting the debugger", async () => {
    const wcSendCommand = vi.fn();
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const entries = new Map([[TARGET_ID, entry]]);

    const result = await sendCommand({
      ensureDebuggerAttached: vi.fn(),
      entries,
      method: "Page.screencastFrameAck",
      params: undefined,
      targetId: TARGET_ID,
    });

    expect(result).toEqual({});
    expect(wcSendCommand).not.toHaveBeenCalled();
  });

  it("delegates Browser.setDownloadBehavior to applyDownloadBehavior", async () => {
    const entry = makeEntry();
    const entries = new Map([[TARGET_ID, entry]]);

    await sendCommand({
      ensureDebuggerAttached: vi.fn(),
      entries,
      method: "Browser.setDownloadBehavior",
      params: { behavior: "allowAndName", downloadPath: "/tmp/dl" },
      targetId: TARGET_ID,
    });

    expect(entry.authorizedDownloadPath).toBe("/tmp/dl");
  });

  it("routes Page.printToPDF through the native printToPDF API", async () => {
    const printToPDF = vi.fn().mockResolvedValue(Buffer.from("PDF_DATA"));
    const entry = makeEntry({ printToPDF });
    const entries = new Map([[TARGET_ID, entry]]);

    const result = await sendCommand({
      ensureDebuggerAttached: vi.fn(),
      entries,
      method: "Page.printToPDF",
      params: { landscape: true, printBackground: false },
      targetId: TARGET_ID,
    });

    expect(printToPDF).toHaveBeenCalledWith({
      landscape: true,
      preferCSSPageSize: false,
      printBackground: false,
    });
    expect(result).toEqual({
      data: Buffer.from("PDF_DATA").toString("base64"),
    });
  });

  it("passes unknown methods through to webContents.debugger.sendCommand", async () => {
    const wcSendCommand = vi.fn().mockResolvedValue({ frameId: "F" });
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const entries = new Map([[TARGET_ID, entry]]);

    const result = await sendCommand({
      ensureDebuggerAttached: vi.fn(),
      entries,
      method: "Page.navigate",
      params: { url: "https://example.com" },
      targetId: TARGET_ID,
    });

    expect(wcSendCommand).toHaveBeenCalledWith("Page.navigate", {
      url: "https://example.com",
    });
    expect(result).toEqual({ frameId: "F" });
  });

  it("rethrows pass-through errors from the debugger", async () => {
    const wcSendCommand = vi.fn().mockRejectedValue(new Error("CDP boom"));
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const entries = new Map([[TARGET_ID, entry]]);

    await expect(
      sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.navigate",
        params: { url: "https://example.com" },
        targetId: TARGET_ID,
      }),
    ).rejects.toThrow("CDP boom");
  });

  it("throws when webContents is unavailable for a pass-through method", async () => {
    const entry = makeEntry({ webContents: false });
    const entries = new Map([[TARGET_ID, entry]]);

    await expect(
      sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.navigate",
        params: undefined,
        targetId: TARGET_ID,
      }),
    ).rejects.toThrow("webContents unavailable");
  });

  describe("Page.captureScreenshot viewport", () => {
    function fakeImage() {
      return {
        isEmpty: () => false,
        toJPEG: (quality: number) => Buffer.from(`JPEG:${quality}`),
        toPNG: () => Buffer.from("PNG"),
      };
    }

    it("serves a viewport capture from capturePage instead of the debugger", async () => {
      const capturePage = vi.fn().mockResolvedValue(fakeImage());
      const wcSendCommand = vi.fn();
      const entry = makeEntry({ capturePage, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: { format: "png" },
        targetId: TARGET_ID,
      });

      expect(capturePage).toHaveBeenCalledWith();
      expect(wcSendCommand).not.toHaveBeenCalled();
      expect(result).toEqual({ data: Buffer.from("PNG").toString("base64") });
    });

    it("defaults to PNG when no format is requested", async () => {
      const capturePage = vi.fn().mockResolvedValue(fakeImage());
      const entry = makeEntry({ capturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: {},
        targetId: TARGET_ID,
      });

      expect(result).toEqual({ data: Buffer.from("PNG").toString("base64") });
    });

    it("encodes as JPEG with the requested quality when requested", async () => {
      const capturePage = vi.fn().mockResolvedValue(fakeImage());
      const entry = makeEntry({ capturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: { format: "jpeg", quality: 42 },
        targetId: TARGET_ID,
      });

      expect(result).toEqual({
        data: Buffer.from("JPEG:42").toString("base64"),
      });
    });

    it("throws fast on an empty frame rather than falling back to the debugger", async () => {
      const capturePage = vi.fn().mockResolvedValue({
        isEmpty: () => true,
        toJPEG: () => Buffer.from(""),
        toPNG: () => Buffer.from(""),
      });
      const wcSendCommand = vi.fn();
      const entry = makeEntry({ capturePage, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Page.captureScreenshot",
          params: {},
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow("empty frame");
      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("Page.captureScreenshot full page (captureBeyondViewport)", () => {
    it("rejects a full-page request and points the agent at PDF export", async () => {
      const capturePage = vi.fn();
      const wcSendCommand = vi.fn();
      const entry = makeEntry({ capturePage, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Page.captureScreenshot",
          params: {
            captureBeyondViewport: true,
            clip: { height: 999, scale: 1, width: 999, x: 0, y: 0 },
          },
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow(/pdf/i);
      // Never emits a tiled/viewport image or touches the debugger for full page.
      expect(capturePage).not.toHaveBeenCalled();
      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("Browser.getWindowForTarget", () => {
    afterEach(() => {
      clearGuestSurface(TARGET_ID);
    });

    it("reports the size the guest is actually laid out at", async () => {
      recordEffectiveGuestSurface({
        size: { height: 910, width: 1300 },
        targetId: TARGET_ID,
      });
      const entries = new Map([[TARGET_ID, makeEntry({})]]);

      const result = (await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Browser.getWindowForTarget",
        params: {},
        targetId: TARGET_ID,
      })) as { bounds: { height: number; width: number } };

      // A constant here goes stale the moment an agent asks for a viewport or
      // the window shrinks under one, and this is the only channel that answers
      // agent-browser's window probe.
      expect(result.bounds).toMatchObject({ height: 910, width: 1300 });
    });

    it("falls back to the default before the renderer has reported", async () => {
      const entries = new Map([[TARGET_ID, makeEntry({})]]);

      const result = (await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Browser.getWindowForTarget",
        params: {},
        targetId: TARGET_ID,
      })) as { bounds: { height: number; width: number } };

      expect(result.bounds).toMatchObject({ height: 800, width: 1280 });
    });
  });

  describe("Emulation.setDeviceMetricsOverride", () => {
    // The renderer owns the budget and reports it; a unit test has to stand in
    // for that. 1440x1265 is a window whose budget is 1872x1644.
    const setBudget = () => {
      setRasterBudget({ height: 1644, width: 1872 });
    };

    afterEach(() => {
      clearGuestSurface(TARGET_ID);
    });

    it("records a size within the budget without touching the debugger", async () => {
      setBudget();
      const wcSendCommand = vi.fn();
      const entries = new Map([[TARGET_ID, makeEntry({ sendCommand: wcSendCommand })]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Emulation.setDeviceMetricsOverride",
          params: { deviceScaleFactor: 0, height: 1000, mobile: false, width: 1600 },
          targetId: TARGET_ID,
        }),
      ).resolves.toEqual({});

      // The guest is resized by the renderer, so nothing is emulated here.
      expect(wcSendCommand).not.toHaveBeenCalled();
      expect(getDesiredGuestSurfaces()).toEqual([
        [TARGET_ID, { height: 1000, width: 1600 }],
      ]);
    });

    it("refuses a size past the budget, naming the maximum, and records nothing", async () => {
      setBudget();
      const wcSendCommand = vi.fn();
      const entries = new Map([[TARGET_ID, makeEntry({ sendCommand: wcSendCommand })]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Emulation.setDeviceMetricsOverride",
          params: { deviceScaleFactor: 0, height: 8000, mobile: false, width: 1920 },
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow(/1872x1644/);

      // Refused rather than clamped: a clamped guest would report the size it
      // was asked for and its captures would disagree with it.
      expect(getDesiredGuestSurfaces()).toEqual([]);
      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    it("clears the recorded size without touching the debugger", async () => {
      setBudget();
      const wcSendCommand = vi.fn();
      const entries = new Map([[TARGET_ID, makeEntry({ sendCommand: wcSendCommand })]]);
      const call = (
        method: Parameters<typeof sendCommand>[0]["method"],
        params?: unknown,
      ) =>
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method,
          params,
          targetId: TARGET_ID,
        });

      await call("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 0,
        height: 1000,
        mobile: false,
        width: 1600,
      });
      await expect(call("Emulation.clearDeviceMetricsOverride")).resolves.toEqual({});

      expect(getDesiredGuestSurfaces()).toEqual([]);
      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("screencast", () => {
    it("returns {} for Page.startScreencast and {} for Page.stopScreencast", async () => {
      vi.useFakeTimers();
      try {
        const entry = makeEntry();
        // capturePage is required by startScreencast's setInterval body.
        // It's never observed in this assertion but must exist.
        Object.assign(entry.webContents ?? {}, {
          capturePage: vi.fn().mockResolvedValue({
            toJPEG: () => Buffer.from(""),
            toPNG: () => Buffer.from(""),
          }),
        });
        const entries = new Map([[TARGET_ID, entry]]);

        const startResult = await sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Page.startScreencast",
          params: {
            format: "jpeg",
            maxHeight: 720,
            maxWidth: 1280,
            quality: 80,
          },
          targetId: TARGET_ID,
        });
        expect(startResult).toEqual({});
        expect(entry.screencastInterval).not.toBeNull();
        expect(entry.screencastSessionId).toBe(1);

        const stopResult = await sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Page.stopScreencast",
          params: undefined,
          targetId: TARGET_ID,
        });
        expect(stopResult).toEqual({});
        expect(entry.screencastInterval).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
  // Chromium delivers keyboard input to whichever widget holds keyboard focus,
  // not to the WebContents whose debugger carried the command. A guest without
  // focus therefore types into Studio's own window, so these are refused.
  // Chromium delivers keyboard input to whichever widget holds keyboard focus,
  // not to the WebContents whose debugger carried the command. A guest without
  // focus types into Studio's own window, so it must reclaim focus first.
  describe("keyboard focus gate", () => {
    // A repair channel that only reports focus once the renderer has been asked
    // for it, the way the real `<webview>` focus round trip behaves.
    function makeRepairableEntry({ succeeds = true } = {}) {
      let focused = false;
      const requestGuestFocus = vi.fn().mockImplementation(() => {
        focused = succeeds;
      });
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const wc = entry.webContents as unknown as {
        executeJavaScript: ReturnType<typeof vi.fn>;
      };
      wc.executeJavaScript = vi
        .fn()
        .mockImplementation(() => Promise.resolve(focused));
      return { entry, requestGuestFocus, wcSendCommand };
    }

    it.each([
      "Input.dispatchKeyEvent",
      "Input.imeSetComposition",
      "Input.insertText",
    ])("reclaims guest focus and then dispatches %s", async (method) => {
      const { entry, requestGuestFocus, wcSendCommand } = makeRepairableEntry();
      const entries = new Map([[TARGET_ID, entry]]);

      await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method,
        params: { text: "hello" },
        requestGuestFocus,
        targetId: TARGET_ID,
      });

      expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("does not ask for focus when the guest already holds it", async () => {
      const requestGuestFocus = vi.fn();
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ hasFocus: true, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Input.insertText",
        params: { text: "hello" },
        requestGuestFocus,
        targetId: TARGET_ID,
      });

      expect(requestGuestFocus).not.toHaveBeenCalled();
      expect(wcSendCommand).toHaveBeenCalledWith("Input.insertText", {
        text: "hello",
      });
    });

    it("refuses when the guest never takes focus back", async () => {
      const { entry, requestGuestFocus, wcSendCommand } = makeRepairableEntry({
        succeeds: false,
      });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Input.insertText",
          params: { text: "hello" },
          requestGuestFocus,
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow(/does not hold keyboard focus/);

      expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    it("refuses when no repair channel is available", async () => {
      const wcSendCommand = vi.fn();
      const entry = makeEntry({ hasFocus: false, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Input.insertText",
          params: { text: "hello" },
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow(/does not hold keyboard focus/);

      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    // Mouse and scroll are routed by hit-testing against the target's own
    // surface, so they reach the guest whether or not it holds focus and must
    // never pay for a focus probe.
    it.each([
      "Input.dispatchMouseEvent",
      "Input.synthesizeScrollGesture",
      "Input.synthesizeTapGesture",
    ])("lets %s through without a focus probe", async (method) => {
      const requestGuestFocus = vi.fn();
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ hasFocus: false, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method,
        params: {},
        requestGuestFocus,
        targetId: TARGET_ID,
      });

      expect(requestGuestFocus).not.toHaveBeenCalled();
      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("fails closed when the focus probe rejects", async () => {
      const wcSendCommand = vi.fn();
      const entry = makeEntry({
        hasFocus: Promise.reject(new Error("renderer gone")),
        sendCommand: wcSendCommand,
      });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        sendCommand({
          ensureDebuggerAttached: vi.fn(),
          entries,
          method: "Input.insertText",
          params: { text: "hello" },
          requestGuestFocus: vi.fn(),
          targetId: TARGET_ID,
        }),
      ).rejects.toThrow(/does not hold keyboard focus/);

      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });
});
