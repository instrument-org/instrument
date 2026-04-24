import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { WebContentsView } from "electron";

import {
  encodeBrowserTargetId,
  ProjectSubdomainSchema,
  StoreId,
} from "@instrument-org/workspace/electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendCommand } from "./dispatch-command";
import { type BrowserEntry, createEntry } from "./entry";

const SUBDOMAIN = ProjectSubdomainSchema.parse("agent-browser-test");
const SESSION_ID = StoreId.newSessionId();
const TARGET_ID = encodeBrowserTargetId(SUBDOMAIN, SESSION_ID);

vi.mock("../cdp", () => ({
  sendCdpCommand: vi.fn(),
}));

const { sendCdpCommand } = await import("../lib/cdp");
const sendCdpCommandMock = vi.mocked(sendCdpCommand);

interface FakeDebugger {
  isAttached: () => boolean;
  sendCommand: ReturnType<typeof vi.fn>;
}

interface FakeWebContents {
  debugger: FakeDebugger;
  isDestroyed: () => boolean;
  printToPDF?: ReturnType<typeof vi.fn>;
}

function makeEntry({
  attached = true,
  destroyed = false,
  printToPDF,
  sendCommand: wcSendCommand = vi.fn(),
  targetId = TARGET_ID,
  webContents = true,
}: {
  attached?: boolean;
  destroyed?: boolean;
  printToPDF?: ReturnType<typeof vi.fn>;
  sendCommand?: ReturnType<typeof vi.fn>;
  targetId?: BrowserTargetId;
  webContents?: boolean;
} = {}): BrowserEntry {
  const wc: FakeWebContents | null = webContents
    ? {
        debugger: {
          isAttached: () => attached,
          sendCommand: wcSendCommand,
        },
        isDestroyed: () => destroyed,
        printToPDF,
      }
    : null;
  const entry = createEntry({
    partitionDir: "/tmp/partition" as AbsolutePath,
    sessionId: SESSION_ID,
    subdomain: SUBDOMAIN,
    targetId,
    // Cast to satisfy the WebContentsView type while exposing only the surface
    // sendCommand actually touches (entry.view.webContents).
    view: { webContents: wc } as unknown as WebContentsView,
  });
  return entry;
}

beforeEach(() => {
  sendCdpCommandMock.mockReset();
});

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

  describe("Page.captureScreenshot rescale", () => {
    it("falls through when captureBeyondViewport is not set", async () => {
      const wcSendCommand = vi.fn().mockResolvedValue({ data: "FALLTHROUGH" });
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: { format: "png" },
        targetId: TARGET_ID,
      });

      expect(sendCdpCommandMock).not.toHaveBeenCalled();
      expect(result).toEqual({ data: "FALLTHROUGH" });
    });

    it("falls through when no clip is provided", async () => {
      const wcSendCommand = vi.fn().mockResolvedValue({ data: "FALLTHROUGH" });
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: { captureBeyondViewport: true },
        targetId: TARGET_ID,
      });

      expect(sendCdpCommandMock).not.toHaveBeenCalled();
      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("falls through when device-scale factor is 1 (no rescale needed)", async () => {
      sendCdpCommandMock.mockResolvedValueOnce({
        contentSize: { width: 1280 },
        cssContentSize: { width: 1280 },
      } as never);
      const wcSendCommand = vi.fn().mockResolvedValue({ data: "FALLTHROUGH" });
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 1600, scale: 1, width: 2560, x: 0, y: 0 },
        },
        targetId: TARGET_ID,
      });

      expect(result).toEqual({ data: "FALLTHROUGH" });
      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("rescales the clip by the HiDPI factor and returns the rewritten capture", async () => {
      sendCdpCommandMock
        .mockResolvedValueOnce({
          // 2x HiDPI: contentSize is 2x cssContentSize.
          contentSize: { width: 2560 },
          cssContentSize: { width: 1280 },
        } as never)
        .mockResolvedValueOnce({ data: "RESCALED" } as never);

      const wcSendCommand = vi.fn();
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 1600, scale: 1, width: 2560, x: 100, y: 200 },
          format: "png",
        },
        targetId: TARGET_ID,
      });

      expect(result).toEqual({ data: "RESCALED" });
      expect(wcSendCommand).not.toHaveBeenCalled();
      const lastCall = sendCdpCommandMock.mock.calls.at(-1);
      expect(lastCall?.[1]).toBe("Page.captureScreenshot");
      expect(lastCall?.[2]).toMatchInlineSnapshot(`
        {
          "captureBeyondViewport": true,
          "clip": {
            "height": 800,
            "scale": 1,
            "width": 1280,
            "x": 50,
            "y": 100,
          },
          "format": "png",
        }
      `);
    });

    it("falls through when getLayoutMetrics throws", async () => {
      sendCdpCommandMock.mockRejectedValueOnce(new Error("metrics boom"));
      const wcSendCommand = vi.fn().mockResolvedValue({ data: "FALLTHROUGH" });
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 1600, scale: 1, width: 2560, x: 0, y: 0 },
        },
        targetId: TARGET_ID,
      });

      expect(result).toEqual({ data: "FALLTHROUGH" });
    });

    it("falls through when the debugger is not attached", async () => {
      const wcSendCommand = vi.fn().mockResolvedValue({ data: "FALLTHROUGH" });
      const entry = makeEntry({ attached: false, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await sendCommand({
        ensureDebuggerAttached: vi.fn(),
        entries,
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 1600, scale: 1, width: 2560, x: 0, y: 0 },
        },
        targetId: TARGET_ID,
      });

      expect(sendCdpCommandMock).not.toHaveBeenCalled();
      expect(wcSendCommand).toHaveBeenCalled();
    });
  });

  describe("screencast", () => {
    it("returns {} for Page.startScreencast and {} for Page.stopScreencast", async () => {
      vi.useFakeTimers();
      try {
        const entry = makeEntry();
        // capturePage is required by startScreencast's setInterval body.
        // It's never observed in this assertion but must exist.
        Object.assign(entry.view.webContents ?? {}, {
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
});
