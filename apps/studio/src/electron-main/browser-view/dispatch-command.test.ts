import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import {
  CdpCommandTimeoutError,
  cdpMethodsHandled,
  browserTargetOf,
  StoreId,
} from "@instrument-org/workspace/electron";
import { noop } from "radashi";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { MAIN_OVERRIDES, MAIN_REFUSALS, sendCommand } from "./dispatch-command";
import { type BrowserEntry, createEntry } from "./entry";
import { noteFrameSession } from "./keyboard-without-focus";
import {
  clearGuestSurface,
  getDesiredGuestSurfaces,
  recordEffectiveGuestSurface,
  setRasterBudget,
} from "./guest-surface";
import { log } from "./log";

// The agent's pointer reads the app's zoom, which is kept in the workspace.
vi.mock("@/electron-main/stores/workspace/window-state", () => ({
  getAppZoom: () => 1,
}));

const TARGET_ID = browserTargetOf(StoreId.newTabId());
const OTHER_TARGET_ID = browserTargetOf(StoreId.newTabId());
const HOST_ID = 7;

interface FakeDebugger {
  isAttached: () => boolean;
  sendCommand: ReturnType<typeof vi.fn>;
}

interface FakeWebContents {
  capturePage?: ReturnType<typeof vi.fn>;
  debugger: FakeDebugger;
  executeJavaScript: Mock<(code: string) => Promise<unknown>>;
  executeJavaScriptInIsolatedWorld: ReturnType<typeof vi.fn>;
  getZoomFactor: () => number;
  hostWebContents?: {
    capturePage: ReturnType<typeof vi.fn>;
    executeJavaScript: Mock<(code: string) => Promise<unknown>>;
    isDestroyed: () => boolean;
  };
  isDestroyed: () => boolean;
  isOffscreen: () => boolean;
  printToPDF?: ReturnType<typeof vi.fn>;
}

const isKeyboardProbe = (code: string) => code.includes("getWebContentsId");

const isRenderingProbe = (code: string) =>
  code.includes("resolve(true)") && code.includes("requestAnimationFrame");

function makeEntry({
  attached = true,
  capturePage,
  destroyed = false,
  // Guests hold keyboard focus in most of these tests; the focus gate has its
  // own cases below.
  hasFocus = true,
  hostCapturePage,
  pageZoom = 1,
  printToPDF,
  rendering = true,
  sendCommand: wcSendCommand = vi.fn(),
  targetId = TARGET_ID,
  webContents = true,
}: {
  attached?: boolean;
  capturePage?: ReturnType<typeof vi.fn>;
  destroyed?: boolean;
  hasFocus?: boolean | Promise<unknown>;
  hostCapturePage?: ReturnType<typeof vi.fn>;
  pageZoom?: number;
  printToPDF?: ReturnType<typeof vi.fn>;
  rendering?: boolean | Promise<unknown>;
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
        executeJavaScript: vi.fn((code: string) => {
          const answer = isRenderingProbe(code) ? rendering : hasFocus;
          return answer instanceof Promise ? answer : Promise.resolve(answer);
        }),
        // Nothing in the isolated world (the agent's pointer) answers.
        executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(undefined),
        getZoomFactor: () => pageZoom,
        // The window's renderer, which answers whether the guest holds the
        // keyboard.
        hostWebContents: {
          capturePage: hostCapturePage ?? vi.fn().mockResolvedValue(undefined),
          executeJavaScript: vi.fn((code: string) =>
            isKeyboardProbe(code)
              ? hasFocus instanceof Promise
                ? hasFocus
                : Promise.resolve(hasFocus)
              : Promise.resolve(undefined),
          ),
          isDestroyed: () => false,
        },
        isDestroyed: () => destroyed,
        isOffscreen: () => false,
        printToPDF,
      }
    : null;
  const entry = createEntry({
    hostId: HOST_ID,
    partitionDir: "/tmp/partition" as AbsolutePath,
    targetId,
  });
  // Cast to the WebContents type while exposing only the surface sendCommand
  // actually touches (entry.webContents).
  entry.webContents = wc as unknown as null | WebContents;
  return entry;
}

type SendCommandOptions = Parameters<typeof sendCommand>[0];

type Defaulted =
  | "describeHost"
  | "ensureDebuggerAttached"
  | "requestGuestFocus"
  | "targetId";

/**
 * `sendCommand` to `TARGET_ID`, with a host described as nothing, a debugger
 * taken as attached and a focus request that does nothing, for the cases that
 * do not exercise those.
 */
function dispatch(
  options: Omit<SendCommandOptions, Defaulted> &
    Partial<Pick<SendCommandOptions, Defaulted>>,
) {
  return sendCommand({
    describeHost: () => Promise.resolve(""),
    ensureDebuggerAttached: noop,
    requestGuestFocus: noop,
    targetId: TARGET_ID,
    ...options,
  });
}

describe("sendCommand", () => {
  it("throws when target is not registered", async () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    await expect(
      dispatch({
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

    const result = await dispatch({
      entries,
      method: "Page.screencastFrameAck",
      params: undefined,
    });

    expect(result).toEqual({});
    expect(wcSendCommand).not.toHaveBeenCalled();
  });

  it("delegates Browser.setDownloadBehavior to applyDownloadBehavior", async () => {
    const entry = makeEntry();
    const entries = new Map([[TARGET_ID, entry]]);

    await dispatch({
      entries,
      method: "Browser.setDownloadBehavior",
      params: { behavior: "allowAndName", downloadPath: "/tmp/dl" },
    });

    expect(entry.authorizedDownloadPath).toBe("/tmp/dl");

    await dispatch({
      entries,
      method: "Browser.setDownloadBehavior",
      params: { behavior: "allowAndName", downloadPath: "dl" },
    });

    expect(entry.authorizedDownloadPath).toBeNull();
  });

  it("routes Page.printToPDF through the native printToPDF API", async () => {
    const printToPDF = vi.fn().mockResolvedValue(Buffer.from("PDF_DATA"));
    const entry = makeEntry({ printToPDF });
    const entries = new Map([[TARGET_ID, entry]]);

    const result = await dispatch({
      entries,
      method: "Page.printToPDF",
      // What agent-browser's CLI sends on every print.
      params: {
        landscape: true,
        preferCSSPageSize: false,
        printBackground: false,
      },
    });

    expect(printToPDF).toHaveBeenCalledWith({
      generateDocumentOutline: true,
      generateTaggedPDF: true,
      landscape: true,
      preferCSSPageSize: true,
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

    const result = await dispatch({
      entries,
      method: "Page.navigate",
      params: { url: "https://example.com" },
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
      dispatch({
        entries,
        method: "Page.navigate",
        params: { url: "https://example.com" },
      }),
    ).rejects.toThrow("CDP boom");
  });

  describe("command timeout", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives Page.navigate 20s before rejecting with a typed timeout", async () => {
      vi.useFakeTimers();
      const entry = makeEntry({
        sendCommand: vi.fn().mockReturnValue(new Promise(noop)),
      });
      const sent = dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.navigate",
        params: { url: "https://example.com" },
      });
      const settled = vi.fn();
      void sent.then(settled, settled);

      await vi.advanceTimersByTimeAsync(5000);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(15_000);
      await expect(sent).rejects.toBeInstanceOf(CdpCommandTimeoutError);
      await expect(sent).rejects.toMatchObject({ method: "Page.navigate" });
    });

    describe("a script that outlasts its command", () => {
      const SCRIPT = {
        awaitPromise: true,
        expression: "scanOrders()",
        returnByValue: true,
      };

      /**
       * A guest whose debugger holds the script's answer until `finish` is
       * called, and answers the check of whether the page still runs scripts
       * unless the page is `blocked`.
       */
      function scriptedGuest({ blocked = false } = {}) {
        const block = (now: boolean) => {
          blocked = now;
        };
        let finish: (answer: unknown) => void = noop;
        const answer = new Promise((resolve) => {
          finish = resolve;
        });
        const wcSendCommand = vi.fn(
          (_method: string, params: { expression?: string }) =>
            params.expression === SCRIPT.expression
              ? answer
              : blocked
                ? new Promise(noop)
                : Promise.resolve({ result: { type: "number", value: 1 } }),
        );
        const entries = new Map([
          [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
          [OTHER_TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
        ]);
        const evaluate = (expression: string, targetId = TARGET_ID) => {
          const sent = dispatch({
            entries,
            method: "Runtime.evaluate",
            params: { ...SCRIPT, expression },
            targetId,
          });
          // Read later; a rejection in between is not unhandled.
          sent.catch(noop);
          return sent;
        };
        return { block, evaluate, finish, wcSendCommand };
      }

      const failureOf = (sent: Promise<unknown>) =>
        sent.then(
          () => {
            throw new Error("the command answered");
          },
          (error: unknown) => error as Error,
        );

      it("says the script is still running when the page answers, and keeps it for the next command", async () => {
        vi.useFakeTimers();
        const { evaluate, finish, wcSendCommand } = scriptedGuest();

        const first = evaluate(SCRIPT.expression);
        await vi.advanceTimersByTimeAsync(20_000);
        const failure = await failureOf(first);

        expect(failure).not.toBeInstanceOf(CdpCommandTimeoutError);
        expect(failure.message).toMatch(
          /^The script was still running after 20s\. The page is responsive/,
        );
        const id = /\[running script: (\w+)\]/.exec(failure.message)?.[1];

        // The next command waits on the same script rather than running it
        // again, and says how long the script has run in all.
        const second = evaluate(`__instrumentRunningScript("${id}")`);
        await vi.advanceTimersByTimeAsync(20_000);
        expect((await failureOf(second)).message).toContain(
          `still running after 40s`,
        );

        const third = evaluate(`__instrumentRunningScript("${id}")`);
        await vi.advanceTimersByTimeAsync(5000);
        const answer = { result: { type: "object", value: { pages: 90 } } };
        finish(answer);
        await expect(third).resolves.toBe(answer);

        expect(
          wcSendCommand.mock.calls.filter(
            ([, params]) => params.expression === SCRIPT.expression,
          ),
        ).toHaveLength(1);
        expect(
          wcSendCommand.mock.calls.some(([, params]) =>
            params.expression?.includes("__instrumentRunningScript"),
          ),
        ).toBe(false);

        // Its answer is delivered once.
        await expect(
          evaluate(`__instrumentRunningScript("${id}")`),
        ).rejects.toThrow("That script's answer is no longer kept");
      });

      it("keeps waiting on a kept script whose page misses one check, and fails it after two in a row", async () => {
        vi.useFakeTimers();
        const guest = scriptedGuest();

        const first = guest.evaluate(SCRIPT.expression);
        await vi.advanceTimersByTimeAsync(20_000);
        const id = /\[running script: (\w+)\]/.exec(
          (await failureOf(first)).message,
        )?.[1];
        const ask = async () => {
          const sent = guest.evaluate(`__instrumentRunningScript("${id}")`);
          await vi.advanceTimersByTimeAsync(21_000);
          return await failureOf(sent);
        };

        // The page is in a long task of its own when the check lands.
        guest.block(true);
        expect((await ask()).message).toContain("still running after 41s");

        // Answering again clears the miss.
        guest.block(false);
        expect((await ask()).message).toContain("still running after 61s");
        guest.block(true);
        expect((await ask()).message).toContain("[running script:");

        const failure = await ask();
        expect(failure).toBeInstanceOf(CdpCommandTimeoutError);
        expect(failure.message).toContain("The browser tab is not responding");
      });

      it("fails as a tab that is not responding when the page answers nothing", async () => {
        vi.useFakeTimers();
        const { evaluate } = scriptedGuest({ blocked: true });

        const sent = evaluate(SCRIPT.expression);
        const settled = vi.fn();
        void sent.then(settled, settled);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        const failure = await failureOf(sent);
        expect(failure).toBeInstanceOf(CdpCommandTimeoutError);
        expect(failure.message).toContain("The browser tab is not responding");
      });

      it("fails a script that does not await as a tab that is not responding", async () => {
        vi.useFakeTimers();
        const entries = new Map([
          [
            TARGET_ID,
            makeEntry({
              sendCommand: vi.fn().mockReturnValue(new Promise(noop)),
            }),
          ],
        ]);
        const sent = dispatch({
          entries,
          method: "Runtime.evaluate",
          params: { expression: "while (true) {}", returnByValue: true },
        });
        sent.catch(noop);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(await failureOf(sent)).toBeInstanceOf(CdpCommandTimeoutError);
      });

      it("refuses to wait on a script another tab runs", async () => {
        vi.useFakeTimers();
        const { evaluate, finish } = scriptedGuest();

        const first = evaluate(SCRIPT.expression);
        await vi.advanceTimersByTimeAsync(20_000);
        const id = /\[running script: (\w+)\]/.exec(
          (await failureOf(first)).message,
        )?.[1];

        await expect(
          evaluate(`__instrumentRunningScript("${id}")`, OTHER_TARGET_ID),
        ).rejects.toThrow("it runs in another tab");

        // Its own tab still gets the answer.
        const asked = evaluate(`__instrumentRunningScript("${id}")`);
        finish("done");
        await expect(asked).resolves.toBe("done");
      });

      it("refuses to wait on a script it does not keep", async () => {
        const { evaluate, wcSendCommand } = scriptedGuest();

        await expect(
          evaluate('__instrumentRunningScript("aaaaaaaa")'),
        ).rejects.toThrow("That script's answer is no longer kept");
        expect(wcSendCommand).not.toHaveBeenCalled();
      });
    });

    it("clears the timer once the command answers", async () => {
      vi.useFakeTimers();
      const entry = makeEntry({
        sendCommand: vi.fn().mockResolvedValue({ frameId: "F" }),
      });

      // Main's own page load: an agent's would start the pointer's own
      // check for whether the agent is still at work.
      await dispatch({
        byAgent: false,
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.navigate",
        params: { url: "https://example.com" },
      });

      expect(vi.getTimerCount()).toBe(0);
    });

    it("fails input as timed out when the guest never answers the rendering probe", async () => {
      vi.useFakeTimers();
      const wcSendCommand = vi.fn();
      const entry = makeEntry({
        rendering: new Promise(noop),
        sendCommand: wcSendCommand,
      });
      const sent = dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown" },
      });
      const settled = sent.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(1000);
      expect(await settled).toBeInstanceOf(CdpCommandTimeoutError);
      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    it("answers a scroll when the guest never answers the settling probe", async () => {
      vi.useFakeTimers();
      const entry = makeEntry({
        hasFocus: new Promise(noop),
        sendCommand: vi.fn().mockResolvedValue({ model: { content: [] } }),
      });
      const sent = dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "DOM.scrollIntoViewIfNeeded",
        params: { nodeId: 1 },
      });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(sent).resolves.toEqual({ model: { content: [] } });
    });
  });

  it("throws when webContents is unavailable for a pass-through method", async () => {
    const entry = makeEntry({ webContents: false });
    const entries = new Map([[TARGET_ID, entry]]);

    await expect(
      dispatch({
        entries,
        method: "Page.navigate",
        params: undefined,
      }),
    ).rejects.toThrow("webContents unavailable");
  });

  describe("Page.captureScreenshot viewport", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

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

      const result = await dispatch({
        entries,
        method: "Page.captureScreenshot",
        params: { format: "png" },
      });

      expect(capturePage).toHaveBeenCalledWith();
      expect(wcSendCommand).not.toHaveBeenCalled();
      expect(result).toEqual({ data: Buffer.from("PNG").toString("base64") });
    });

    it("defaults to PNG when no format is requested", async () => {
      const capturePage = vi.fn().mockResolvedValue(fakeImage());
      const entry = makeEntry({ capturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await dispatch({
        entries,
        method: "Page.captureScreenshot",
        params: {},
      });

      expect(result).toEqual({ data: Buffer.from("PNG").toString("base64") });
    });

    it("encodes as JPEG with the requested quality when requested", async () => {
      const capturePage = vi.fn().mockResolvedValue(fakeImage());
      const entry = makeEntry({ capturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await dispatch({
        entries,
        method: "Page.captureScreenshot",
        params: { format: "jpeg", quality: 42 },
      });

      expect(result).toEqual({
        data: Buffer.from("JPEG:42").toString("base64"),
      });
    });

    // A page navigated to while the window is covered has no frame until the
    // window itself draws; until then its capture fails at once.
    it("makes the window draw so a guest with no frame yet can be captured", async () => {
      const hostCapturePage = vi.fn().mockResolvedValue(fakeImage());
      const capturePage = vi
        .fn()
        .mockImplementation(() =>
          hostCapturePage.mock.calls.length > 0
            ? Promise.resolve(fakeImage())
            : Promise.reject(new Error("UnknownVizError")),
        );
      const entry = makeEntry({ capturePage, hostCapturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const result = await dispatch({
        entries,
        method: "Page.captureScreenshot",
        params: {},
      });

      expect(hostCapturePage).toHaveBeenCalledWith(
        { height: 1, width: 1, x: 0, y: 0 },
        { stayHidden: true },
      );
      expect(result).toEqual({ data: Buffer.from("PNG").toString("base64") });
    });

    it("names the covered window when a capture never gets a frame, and logs it", async () => {
      vi.useFakeTimers();
      const capturePage = vi.fn().mockReturnValue(new Promise(noop));
      const errorSpy = vi.spyOn(log, "error").mockImplementation(noop);
      const entry = makeEntry({ capturePage });
      const entries = new Map([[TARGET_ID, entry]]);

      const pending = dispatch({
        entries,
        method: "Page.captureScreenshot",
        params: {},
      });
      const failure = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5000);
      expect(String(await failure)).toContain(
        "most likely because the Instrument window is covered",
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("method=Page.captureScreenshot"),
      );
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
        dispatch({
          entries,
          method: "Page.captureScreenshot",
          params: {},
        }),
      ).rejects.toThrow("empty frame");
      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("Page.captureScreenshot beyond the viewport", () => {
    const METRICS = {
      cssContentSize: { height: 4836, width: 1280, x: 0, y: 0 },
      cssLayoutViewport: {
        clientHeight: 800,
        clientWidth: 1280,
        pageX: 0,
        pageY: 0,
      },
    };

    /** A debugger that answers the page's layout metrics and any capture. */
    function debuggerWith(metrics: unknown) {
      return vi.fn((method: string) =>
        Promise.resolve(
          method === "Page.getLayoutMetrics" ? metrics : { data: "ELEMENT" },
        ),
      );
    }

    // agent-browser sends an element and `--full` alike with
    // captureBeyondViewport and a clip in document coordinates.
    it.each([
      ["in view", { height: 90, scale: 1, width: 240, x: 40, y: 119.875 }],
      [
        "below the fold",
        { height: 80, scale: 1, width: 300, x: 20, y: 2869.875 },
      ],
    ])("sends an element %s to the debugger as asked", async (_, clip) => {
      const capturePage = vi.fn();
      const wcSendCommand = debuggerWith(METRICS);
      const entry = makeEntry({ capturePage, sendCommand: wcSendCommand });
      const params = { captureBeyondViewport: true, clip, format: "png" };

      const result = await dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.captureScreenshot",
        params,
      });

      expect(result).toEqual({ data: "ELEMENT" });
      expect(wcSendCommand.mock.calls).toEqual([
        ["Page.getLayoutMetrics", {}],
        ["Page.captureScreenshot", params],
      ]);
      expect(capturePage).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a clip of the whole document",
        { height: 800, scale: 1, width: 1280, x: 0, y: 0 },
      ],
      ["no clip, which is the whole document", undefined],
    ])("captures a page one viewport tall from %s", async (_, clip) => {
      const wcSendCommand = debuggerWith({
        ...METRICS,
        cssContentSize: { height: 800, width: 1280, x: 0, y: 0 },
      });
      const entry = makeEntry({ sendCommand: wcSendCommand });

      const result = await dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.captureScreenshot",
        params: { captureBeyondViewport: true, clip, format: "png" },
      });

      expect(result).toEqual({ data: "ELEMENT" });
      expect(wcSendCommand.mock.calls).toEqual([
        ["Page.getLayoutMetrics", {}],
        [
          "Page.captureScreenshot",
          {
            captureBeyondViewport: true,
            clip: { height: 800, scale: 1, width: 1280, x: 0, y: 0 },
            format: "png",
          },
        ],
      ]);
    });

    it("takes a whole page taller than the viewport a viewport at a time", async () => {
      const wcSendCommand = debuggerWith(METRICS);
      const entry = makeEntry({ sendCommand: wcSendCommand });

      // The pieces here are no images, so joining them fails; what is asked
      // of the debugger before that is what this reads.
      await dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 4836, scale: 1, width: 1280, x: 0, y: 0 },
        },
      }).catch(() => undefined);

      expect(wcSendCommand.mock.calls.slice(0, 2)).toEqual([
        ["Page.getLayoutMetrics", {}],
        [
          "Page.captureScreenshot",
          {
            captureBeyondViewport: true,
            clip: { height: 800, scale: 1, width: 1280, x: 0, y: 0 },
            format: "png",
          },
        ],
      ]);
    });

    it("sends an element of a zoomed page where its zoom draws it", async () => {
      // A page at half zoom measures itself and its elements at twice the
      // px the debugger captures in.
      const wcSendCommand = debuggerWith({
        ...METRICS,
        cssLayoutViewport: { clientHeight: 1600, clientWidth: 2560 },
      });
      const entry = makeEntry({ pageZoom: 0.5, sendCommand: wcSendCommand });

      await dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        method: "Page.captureScreenshot",
        params: {
          captureBeyondViewport: true,
          clip: { height: 300, scale: 1, width: 500, x: 100, y: 1900 },
          format: "png",
        },
      });

      expect(wcSendCommand.mock.calls[1]).toEqual([
        "Page.captureScreenshot",
        {
          captureBeyondViewport: true,
          clip: { height: 150, scale: 1, width: 250, x: 50, y: 950 },
          format: "png",
        },
      ]);
    });

    it("refuses when the page reports no layout", async () => {
      const capturePage = vi.fn();
      const wcSendCommand = debuggerWith({});
      const entry = makeEntry({ capturePage, sendCommand: wcSendCommand });

      await expect(
        dispatch({
          entries: new Map([[TARGET_ID, entry]]),
          method: "Page.captureScreenshot",
          params: {
            captureBeyondViewport: true,
            clip: { height: 90, scale: 1, width: 240, x: 40, y: 120 },
          },
        }),
      ).rejects.toThrow(
        "The page did not report its size, so nothing beyond the viewport could be captured. Capture the viewport with `agent-browser screenshot`, or export the page with `agent-browser pdf <path>`.",
      );
      expect(capturePage).not.toHaveBeenCalled();
      expect(wcSendCommand).not.toHaveBeenCalledWith(
        "Page.captureScreenshot",
        expect.anything(),
      );
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

      const result = (await dispatch({
        entries,
        method: "Browser.getWindowForTarget",
        params: {},
      })) as { bounds: { height: number; width: number } };

      // A constant here goes stale the moment an agent asks for a viewport or
      // the window shrinks under one, and this is the only channel that answers
      // agent-browser's window probe.
      expect(result.bounds).toMatchObject({ height: 910, width: 1300 });
    });

    it("falls back to the default before the renderer has reported", async () => {
      const entries = new Map([[TARGET_ID, makeEntry({})]]);

      const result = (await dispatch({
        entries,
        method: "Browser.getWindowForTarget",
        params: {},
      })) as { bounds: { height: number; width: number } };

      expect(result.bounds).toMatchObject({ height: 800, width: 1280 });
    });
  });

  describe("Emulation.setDeviceMetricsOverride", () => {
    // The renderer owns the budget and reports it; a unit test has to stand in
    // for that. 1440x1265 is a window whose budget is 1872x1644.
    const setBudget = () => {
      setRasterBudget(HOST_ID, { height: 1644, width: 1872 });
    };

    afterEach(() => {
      clearGuestSurface(TARGET_ID);
    });

    it("goes by the budget of the guest's own window, not another's", async () => {
      setBudget();
      // A smaller window reporting after this one, such as a spare starting.
      setRasterBudget(HOST_ID + 1, { height: 400, width: 400 });
      await expect(
        dispatch({
          entries: new Map([[TARGET_ID, makeEntry()]]),
          method: "Emulation.setDeviceMetricsOverride",
          params: {
            deviceScaleFactor: 0,
            height: 1000,
            mobile: false,
            width: 1600,
          },
        }),
      ).resolves.toEqual({});
    });

    it("records a size within the budget without touching the debugger", async () => {
      setBudget();
      const wcSendCommand = vi.fn();
      const entries = new Map([
        [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
      ]);

      await expect(
        dispatch({
          entries,
          method: "Emulation.setDeviceMetricsOverride",
          params: {
            deviceScaleFactor: 0,
            height: 1000,
            mobile: false,
            width: 1600,
          },
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
      const entries = new Map([
        [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
      ]);

      await expect(
        dispatch({
          entries,
          method: "Emulation.setDeviceMetricsOverride",
          params: {
            deviceScaleFactor: 0,
            height: 8000,
            mobile: false,
            width: 1920,
          },
        }),
      ).rejects.toThrow(/1872x1644/);

      // Refused rather than clamped: a clamped guest would report the size it
      // was asked for and its captures would disagree with it.
      expect(getDesiredGuestSurfaces()).toEqual([]);
      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    it.each([
      { expected: "accepts", shown: true },
      { expected: "refuses", shown: false },
    ])(
      "$expected a height past the budget at 54% zoom when shown is $shown",
      async ({ shown }) => {
        setBudget();
        const entry = makeEntry({ pageZoom: 0.54 });
        entry.shown = shown;
        const asked = dispatch({
          entries: new Map([[TARGET_ID, entry]]),
          method: "Emulation.setDeviceMetricsOverride",
          // 1700 tall is past 1644 at full size, and 918 drawn at 54%.
          params: {
            deviceScaleFactor: 0,
            height: 1700,
            mobile: false,
            width: 1024,
          },
        });
        if (shown) {
          await expect(asked).resolves.toEqual({});
        } else {
          await expect(asked).rejects.toThrow(/1872x1644/);
        }
      },
    );

    it("names the most a shown page can ask for at its zoom", async () => {
      setBudget();
      const entry = makeEntry({ pageZoom: 0.5 });
      entry.shown = true;
      await expect(
        dispatch({
          entries: new Map([[TARGET_ID, entry]]),
          method: "Emulation.setDeviceMetricsOverride",
          params: {
            deviceScaleFactor: 0,
            height: 4000,
            mobile: false,
            width: 1024,
          },
        }),
      ).rejects.toThrow(/3744x3288/);
    });

    it("clears the recorded size without touching the debugger", async () => {
      setBudget();
      const wcSendCommand = vi.fn();
      const entries = new Map([
        [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
      ]);
      const call = (
        method: Parameters<typeof sendCommand>[0]["method"],
        params?: unknown,
      ) =>
        dispatch({
          entries,
          method,
          params,
        });

      await call("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 0,
        height: 1000,
        mobile: false,
        width: 1600,
      });
      await expect(
        call("Emulation.clearDeviceMetricsOverride"),
      ).resolves.toEqual({});

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

        const startResult = await dispatch({
          entries,
          method: "Page.startScreencast",
          params: {
            format: "jpeg",
            maxHeight: 720,
            maxWidth: 1280,
            quality: 80,
          },
        });
        expect(startResult).toEqual({});
        expect(entry.screencastInterval).not.toBeNull();
        expect(entry.screencastSessionId).toBe(1);

        const stopResult = await dispatch({
          entries,
          method: "Page.stopScreencast",
          params: undefined,
        });
        expect(stopResult).toEqual({});
        expect(entry.screencastInterval).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // agent-browser measures an element's content quads, checks what their
  // center would hit, and presses it several commands later. A page that
  // moves in between would take the press on whatever is at the point by
  // then.
  describe("a press on an element that moved", () => {
    const quads = (y: number) => ({
      quads: [[0, y, 10, y, 10, y + 10, 0, y + 10]],
    });
    const click = { button: "left", clickCount: 1, x: 5, y: 398 };

    /**
     * A guest that answers each `DOM.getContentQuads` with the next of
     * `answers`, and names `underPointer` as the element at any point asked
     * about.
     */
    function guestMeasuring(answers: unknown[], underPointer?: string) {
      const wcSendCommand = vi.fn().mockImplementation((method: string) => {
        if (method === "Runtime.evaluate") {
          return Promise.resolve({ result: { objectId: underPointer } });
        }
        if (method !== "DOM.getContentQuads") {
          return Promise.resolve({});
        }
        const answer = answers.shift();
        return answer === "detached"
          ? Promise.reject(new Error("Node is detached from document"))
          : Promise.resolve(answer);
      });
      const entries = new Map([
        [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
      ]);
      const sent = (method: string) =>
        wcSendCommand.mock.calls.filter(([m]) => m === method);
      return {
        measurements: () => sent("DOM.getContentQuads"),
        presses: () =>
          sent("Input.dispatchMouseEvent").filter(
            ([, params]) =>
              (params as { type: string }).type === "mousePressed",
          ),
        send: (method: string, params: unknown, frameSession?: string) =>
          dispatch({ entries, frameSession, method, params }),
        sent,
      };
    }

    // The element was measured at quads(393), whose center is 5,398; each
    // case lists what measuring it again before the press answers.
    it.each([
      { label: "sends an unmoved press as it came", remeasure: quads(393) },
      {
        label: "refuses a press when the element moved",
        refusal: /element moved after it was measured.*Click it again/,
        remeasure: quads(356),
      },
      {
        label: "refuses a press when the element is gone",
        refusal: /can no longer be found.*Take a snapshot/,
        remeasure: "detached",
      },
      {
        label: "refuses a press when the element has no box left",
        refusal: /can no longer be found.*Take a snapshot/,
        remeasure: { quads: [] },
      },
    ])("$label", async ({ refusal, remeasure }) => {
      const { presses, send } = guestMeasuring([quads(393), remeasure]);

      await send("DOM.getContentQuads", { backendNodeId: 7 });
      const press = send("Input.dispatchMouseEvent", {
        ...click,
        type: "mousePressed",
      });

      if (refusal) {
        await expect(press).rejects.toThrow(refusal);
        expect(presses()).toEqual([]);
        return;
      }
      await press;
      expect(presses()).toEqual([
        ["Input.dispatchMouseEvent", { ...click, type: "mousePressed" }],
      ]);
    });

    it("takes the largest piece of a link that wraps as the point measured", async () => {
      // A link from 508 to 643 on one line and 264 to 339 on the next.
      // agent-browser presses the center of the longer piece, rounded.
      const wrapped = (dy: number) => ({
        quads: [
          [508, 242 + dy, 643, 242 + dy, 643, 261 + dy, 508, 261 + dy],
          [264, 268 + dy, 339, 268 + dy, 339, 287 + dy, 264, 287 + dy],
        ],
      });
      const { presses, send } = guestMeasuring([wrapped(0), wrapped(-36)]);

      await send("DOM.getContentQuads", { backendNodeId: 7 });
      await expect(
        send("Input.dispatchMouseEvent", {
          ...click,
          type: "mousePressed",
          x: 576,
          y: 252,
        }),
      ).rejects.toThrow(/element moved after it was measured/);
      expect(presses()).toEqual([]);
    });

    it("sends a press aimed somewhere else without measuring again", async () => {
      const answers = [quads(393), quads(356)];
      const { presses, send } = guestMeasuring(answers);

      await send("DOM.getContentQuads", { backendNodeId: 7 });
      await send("Input.dispatchMouseEvent", {
        ...click,
        type: "mousePressed",
        x: 200,
        y: 40,
      });

      expect(answers).toHaveLength(1);
      expect(presses()).toHaveLength(1);
    });

    it("checks only the first press of a double click", async () => {
      const answers = [quads(393), quads(393), quads(356)];
      const { presses, send } = guestMeasuring(answers);

      await send("DOM.getContentQuads", { backendNodeId: 7 });
      for (const clickCount of [1, 2]) {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await send("Input.dispatchMouseEvent", {
            ...click,
            clickCount,
            type,
          });
        }
      }

      expect(answers).toHaveLength(1);
      expect(presses()).toHaveLength(2);
    });

    it("measures after the agent's pointer has shown the press, with nothing asked of the page between that and the press", async () => {
      // The page moves the element while it draws the pointer's press.
      let y = 393;
      let movesAt: number | undefined = 356;
      const asked: string[] = [];
      const wcSendCommand = vi.fn().mockImplementation((method: string) => {
        asked.push(method);
        return Promise.resolve(
          method === "DOM.getContentQuads" ? quads(y) : {},
        );
      });
      const entry = makeEntry({ sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);
      const send = (method: string, params: unknown) =>
        dispatch({ byAgent: true, entries, method, params });
      await send("DOM.getContentQuads", { backendNodeId: 7 });
      asked.length = 0;
      const page = entry.webContents;
      if (!page) {
        throw new Error("the entry has no page");
      }
      vi.spyOn(page, "executeJavaScriptInIsolatedWorld").mockImplementation(
        () => {
          asked.push("pointer");
          y = movesAt ?? y;
          return Promise.resolve(undefined);
        },
      );

      await expect(
        send("Input.dispatchMouseEvent", { ...click, type: "mousePressed" }),
      ).rejects.toThrow(/element moved after it was measured/);
      expect(asked).toEqual(["pointer", "DOM.getContentQuads"]);

      y = 393;
      movesAt = undefined;
      asked.length = 0;
      await send("DOM.getContentQuads", { backendNodeId: 7 });
      await send("Input.dispatchMouseEvent", {
        ...click,
        type: "mousePressed",
      });
      expect(asked).toEqual([
        "DOM.getContentQuads",
        "pointer",
        "DOM.getContentQuads",
        "Input.dispatchMouseEvent",
      ]);
    });

    it("holds the point pressed, which agent-browser rounds, to the element rather than the point measured", async () => {
      // Measured from 0.4 to 10.4 across, so its center is 5.4 and the press
      // comes at 5. Moved to start at 5.2, the element still has 5.4 on it
      // and no longer has 5.
      const across = (x: number) => ({
        quads: [[x, 393, x + 10, 393, x + 10, 403, x, 403]],
      });
      const { presses, send } = guestMeasuring([across(0.4), across(5.2)]);

      await send("DOM.getContentQuads", { backendNodeId: 7 });
      await expect(
        send("Input.dispatchMouseEvent", { ...click, type: "mousePressed" }),
      ).rejects.toThrow(/element moved after it was measured/);
      expect(presses()).toEqual([]);
    });

    // A click by selector or by `find` names no element to the debugger: the
    // pointer arriving at 5,398 is the first the host sees of it, and the
    // element there is the one measured.
    describe("that agent-browser measured in a script of its own", () => {
      const move = { type: "mouseMoved", x: 5, y: 398 };
      const press = { ...click, type: "mousePressed" };

      it.each([
        { label: "sends a press on an unmoved element", then: quads(393) },
        {
          label: "refuses a press when the element moved",
          refusal: /element moved after it was measured.*Click it again/,
          then: quads(364),
        },
        {
          label: "refuses a press when the element is gone",
          refusal: /can no longer be found.*Take a snapshot/,
          then: "detached",
        },
        {
          // A hover style that grows the element, or lifts it a little.
          label: "sends a press on an element that changed around the point",
          then: { quads: [[-2, 389, 12, 389, 12, 403, -2, 403]] },
        },
      ])("$label", async ({ refusal, then }) => {
        const { measurements, presses, send, sent } = guestMeasuring(
          [quads(393), then],
          "element-1",
        );

        await send("Input.dispatchMouseEvent", move);
        const pressed = send("Input.dispatchMouseEvent", press);

        if (refusal) {
          await expect(pressed).rejects.toThrow(refusal);
          expect(presses()).toEqual([]);
        } else {
          await pressed;
          expect(presses()).toEqual([["Input.dispatchMouseEvent", press]]);
        }
        expect(sent("Runtime.evaluate")).toEqual([
          [
            "Runtime.evaluate",
            expect.objectContaining({
              expression: "document.elementFromPoint(5, 398)",
            }),
          ],
        ]);
        expect(measurements()).toEqual([
          ["DOM.getContentQuads", { objectId: "element-1" }],
          ["DOM.getContentQuads", { objectId: "element-1" }],
        ]);
      });

      it("holds a press on an element's padding to the element staying where it was", async () => {
        // The pointer is at 5,398 and the content box starts below it.
        const { presses, send } = guestMeasuring(
          [quads(400), quads(401)],
          "element-1",
        );

        await send("Input.dispatchMouseEvent", move);
        await expect(send("Input.dispatchMouseEvent", press)).rejects.toThrow(
          /element moved after it was measured/,
        );
        expect(presses()).toEqual([]);
      });

      it("refuses a press on an element's content once the content has left the point, however little it moved", async () => {
        // The pointer is at 5,398, just inside content that starts at 397.8.
        const { presses, send } = guestMeasuring(
          [quads(397.8), quads(398.2)],
          "element-1",
        );

        await send("Input.dispatchMouseEvent", move);
        await expect(send("Input.dispatchMouseEvent", press)).rejects.toThrow(
          /element moved after it was measured/,
        );
        expect(presses()).toEqual([]);
      });

      it("takes the element under the pointer afresh each time the pointer arrives", async () => {
        // The page puts another button where the first was between two
        // arrivals at the same point, as a hover that swaps one for the
        // other does.
        const under = ["element-1", "element-2"];
        const wcSendCommand = vi
          .fn()
          .mockImplementation((method: string, params: unknown) => {
            if (method === "Runtime.evaluate") {
              return Promise.resolve({ result: { objectId: under.shift() } });
            }
            if (method !== "DOM.getContentQuads") {
              return Promise.resolve({});
            }
            return under.length === 0 &&
              (params as { objectId: string }).objectId === "element-1"
              ? Promise.reject(new Error("Node is detached from document"))
              : Promise.resolve(quads(393));
          });
        const entries = new Map([
          [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
        ]);
        const send = (params: unknown) =>
          dispatch({ entries, method: "Input.dispatchMouseEvent", params });

        await send(move);
        await send(move);
        await send(press);

        expect(
          wcSendCommand.mock.calls.filter(
            ([method]) => method === "DOM.getContentQuads",
          ),
        ).toEqual([
          ["DOM.getContentQuads", { objectId: "element-1" }],
          ["DOM.getContentQuads", { objectId: "element-2" }],
          ["DOM.getContentQuads", { objectId: "element-2" }],
        ]);
      });

      it("checks a click by ref against the element agent-browser named", async () => {
        const { measurements, presses, send, sent } = guestMeasuring(
          [quads(393), quads(356)],
          "element-1",
        );

        await send("DOM.getContentQuads", { backendNodeId: 7 });
        await send("Input.dispatchMouseEvent", move);
        await expect(send("Input.dispatchMouseEvent", press)).rejects.toThrow(
          /element moved after it was measured/,
        );

        expect(sent("Runtime.evaluate")).toEqual([]);
        expect(measurements()).toEqual([
          ["DOM.getContentQuads", { backendNodeId: 7 }],
          ["DOM.getContentQuads", { backendNodeId: 7 }],
        ]);
        expect(presses()).toEqual([]);
      });

      it("checks a press in a frame of its own against the element in that frame", async () => {
        const { presses, send, sent } = guestMeasuring(
          [quads(393), quads(364)],
          "element-1",
        );

        await send("Input.dispatchMouseEvent", move, "frame-session-1");
        await expect(
          send("Input.dispatchMouseEvent", press, "frame-session-1"),
        ).rejects.toThrow(/element moved after it was measured/);

        expect(
          [...sent("Runtime.evaluate"), ...sent("DOM.getContentQuads")].map(
            ([, , session]) => session as unknown,
          ),
        ).toEqual(["frame-session-1", "frame-session-1", "frame-session-1"]);
        expect(presses()).toEqual([]);
      });

      it("sends a press in a frame of its own that stayed where it was", async () => {
        const { presses, send } = guestMeasuring(
          [quads(393), quads(393)],
          "element-1",
        );

        await send("Input.dispatchMouseEvent", move, "frame-session-1");
        await send("Input.dispatchMouseEvent", press, "frame-session-1");

        expect(presses()).toEqual([
          ["Input.dispatchMouseEvent", press, "frame-session-1"],
        ]);
      });

      it("sends a press where the pointer found no element", async () => {
        const answers = [quads(393)];
        const { presses, send } = guestMeasuring(answers);

        await send("Input.dispatchMouseEvent", move);
        await send("Input.dispatchMouseEvent", press);

        expect(answers).toHaveLength(1);
        expect(presses()).toHaveLength(1);
      });

      it("measures nothing again for a pointer that moves on without pressing", async () => {
        const answers = [quads(393), quads(100), quads(364)];
        const { presses, send } = guestMeasuring(answers, "element-1");

        // A hover at one point, the pointer sent to a second, a press at a third.
        await send("Input.dispatchMouseEvent", move);
        await send("Input.dispatchMouseEvent", { ...move, x: 60, y: 105 });
        await send("Input.dispatchMouseEvent", { ...press, x: 200, y: 40 });

        expect(answers).toHaveLength(1);
        expect(presses()).toHaveLength(1);
      });
    });

    // agent-browser's own click script waits in the page for the element to
    // hold still, so running it a second time would wait twice and could
    // scroll again.
    it.each([
      {
        method: "Runtime.evaluate",
        params: {
          awaitPromise: true,
          expression:
            "(async () => { el.scrollIntoView({ block: 'center' }); const blockerAt = 0; return { x, y }; })()",
        },
      },
      {
        method: "Runtime.callFunctionOn",
        params: {
          awaitPromise: true,
          functionDeclaration:
            "async function() { this.scrollIntoViewIfNeeded(true); return { x, y }; }",
          objectId: "1",
        },
      },
    ])("runs agent-browser's click script once, as $method", async (script) => {
      const wcSendCommand = vi
        .fn()
        .mockResolvedValue({ result: { value: { x: 1, y: 390 } } });
      const entry = makeEntry({ sendCommand: wcSendCommand });

      const result = await dispatch({
        entries: new Map([[TARGET_ID, entry]]),
        ...script,
      });

      expect(result).toEqual({ result: { value: { x: 1, y: 390 } } });
      expect(wcSendCommand).toHaveBeenCalledTimes(1);
    });
  });

  it("logs each press with what it hit and whether the user could see it", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(noop);
    const entry = makeEntry({
      hasFocus: Promise.resolve("hit=p#mwFw target=none visibility=visible"),
      sendCommand: vi.fn().mockResolvedValue({}),
    });

    await dispatch({
      describeHost: () => Promise.resolve("window=focused tab=shown"),
      entries: new Map([[TARGET_ID, entry]]),
      method: "Input.dispatchMouseEvent",
      params: { type: "mousePressed", x: 5, y: 398 },
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^agent press targetId=\S+ at=5,398 hit=p#mwFw target=none visibility=visible window=focused tab=shown ack=\d+ms$/,
      ),
    );
    info.mockRestore();
  });

  // A page that is not rendering never acknowledges a press, so input to it
  // would hang until the timeout; it is refused up front with the reason.
  describe("not-rendering gate", () => {
    it.each([
      "Input.dispatchMouseEvent",
      "Input.dispatchKeyEvent",
      "Input.insertText",
      "Input.synthesizeTapGesture",
    ])("refuses %s while the page is not rendering", async (method) => {
      const wcSendCommand = vi.fn();
      const entry = makeEntry({ rendering: false, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await expect(
        dispatch({
          entries,
          method,
          params: {},
          requestGuestFocus: vi.fn(),
        }),
      ).rejects.toThrow(/hidden, minimized, or covered by other windows/);

      expect(wcSendCommand).not.toHaveBeenCalled();
    });

    // A covered or minimized Studio window renders the guest again once it is
    // made to draw; the input goes through rather than being refused.
    it("delivers input once making the window draw gets the page rendering", async () => {
      const hostCapturePage = vi.fn().mockResolvedValue({});
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ hostCapturePage, sendCommand: wcSendCommand });
      const wc = entry.webContents as unknown as {
        executeJavaScript: ReturnType<typeof vi.fn>;
      };
      wc.executeJavaScript = vi.fn().mockImplementation(
        (code: string) =>
          // A frame arrives a moment after the probe asks for one.
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                isRenderingProbe(code)
                  ? hostCapturePage.mock.calls.length > 0
                  : true,
              );
            }, 0);
          }),
      );
      const entries = new Map([[TARGET_ID, entry]]);

      await dispatch({
        entries,
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown" },
        requestGuestFocus: vi.fn(),
      });

      expect(hostCapturePage).toHaveBeenCalledWith(
        { height: 1, width: 1, x: 0, y: 0 },
        { stayHidden: true },
      );
      expect(wcSendCommand).toHaveBeenCalledWith("Input.dispatchKeyEvent", {
        type: "keyDown",
      });
    });

    it("still answers reads while the page is not rendering", async () => {
      const wcSendCommand = vi.fn().mockResolvedValue({ result: {} });
      const entry = makeEntry({ rendering: false, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await dispatch({
        entries,
        method: "Runtime.evaluate",
        params: { expression: "1" },
      });

      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("delivers input when the rendering probe fails", async () => {
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({
        rendering: Promise.reject(new Error("renderer gone")),
        sendCommand: wcSendCommand,
      });
      const entries = new Map([[TARGET_ID, entry]]);

      await dispatch({
        entries,
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 1, y: 1 },
      });

      expect(wcSendCommand).toHaveBeenCalled();
    });
  });

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
      const wc = entry.webContents as unknown as FakeWebContents;
      wc.hostWebContents!.executeJavaScript.mockImplementation((code: string) =>
        Promise.resolve(isKeyboardProbe(code) && focused),
      );
      return { entry, requestGuestFocus, wcSendCommand };
    }

    it.each([
      "Input.dispatchKeyEvent",
      "Input.imeSetComposition",
      "Input.insertText",
    ])("reclaims guest focus and then dispatches %s", async (method) => {
      const { entry, requestGuestFocus, wcSendCommand } = makeRepairableEntry();
      const entries = new Map([[TARGET_ID, entry]]);

      await dispatch({
        entries,
        method,
        params: { text: "hello" },
        requestGuestFocus,
      });

      expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
      expect(wcSendCommand).toHaveBeenCalled();
    });

    it("does not ask for focus when the guest already holds it", async () => {
      const requestGuestFocus = vi.fn();
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ hasFocus: true, sendCommand: wcSendCommand });
      const entries = new Map([[TARGET_ID, entry]]);

      await dispatch({
        entries,
        method: "Input.insertText",
        params: { text: "hello" },
        requestGuestFocus,
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

      vi.useFakeTimers();
      try {
        const sent = dispatch({
          entries,
          method: "Input.insertText",
          params: { text: "hello" },
          requestGuestFocus,
        });
        void sent.catch(noop);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(sent).rejects.toThrow(/does not hold keyboard focus/);
      } finally {
        vi.useRealTimers();
      }

      expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
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

      await dispatch({
        entries,
        method,
        params: {},
        requestGuestFocus,
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

      vi.useFakeTimers();
      try {
        const sent = dispatch({
          entries,
          method: "Input.insertText",
          params: { text: "hello" },
          requestGuestFocus: vi.fn(),
        });
        void sent.catch(noop);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(sent).rejects.toThrow(/does not hold keyboard focus/);
      } finally {
        vi.useRealTimers();
      }

      expect(wcSendCommand).not.toHaveBeenCalled();
    });
  });
});

// Typing sent to the guest itself, so the window's focus stays where the
// person left it; anything that cannot go that way takes focus as before.
describe("typing without focus", () => {
  // A guest that does not hold the window's focus, whose page answers the
  // typing world's check with `armed` (or what `where` says), reports `seen`
  // input events for a commit, and the key's last event once it is handled.
  function makeUnfocusedEntry({
    seen = 2,
    where = "armed",
  }: { seen?: number | Promise<unknown>; where?: string } = {}) {
    let focused = false;
    const requestGuestFocus = vi.fn().mockImplementation(() => {
      focused = true;
    });
    const wcSendCommand = vi.fn().mockResolvedValue({});
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const insertText = vi.fn().mockResolvedValue(undefined);
    const sendInputEvent = vi.fn();
    const host = (entry.webContents as unknown as FakeWebContents)
      .hostWebContents!;
    host.executeJavaScript.mockImplementation((code: string) =>
      Promise.resolve(isKeyboardProbe(code) && focused),
    );
    Object.assign(entry.webContents!, {
      executeJavaScript: vi
        .fn()
        .mockImplementation((code: string) =>
          Promise.resolve(isRenderingProbe(code) ? true : focused),
        ),
      executeJavaScriptInIsolatedWorld: vi
        .fn()
        .mockImplementation((_world: number, [{ code }]: [{ code: string }]) =>
          code.includes(".seen()")
            ? seen instanceof Promise
              ? seen
              : Promise.resolve(seen)
            : Promise.resolve(code.includes(".handled()") ? "keypress" : where),
        ),
      insertText,
      sendInputEvent,
    });
    return {
      entries: new Map([[TARGET_ID, entry]]),
      insertText,
      requestGuestFocus,
      sendInputEvent,
      wcSendCommand,
    };
  }

  it("commits text through the guest without asking for focus", async () => {
    const { entries, insertText, requestGuestFocus, wcSendCommand } =
      makeUnfocusedEntry();

    await expect(
      dispatch({
        entries,
        method: "Input.insertText",
        params: { text: "First.\n\nSecond." },
        requestGuestFocus,
      }),
    ).resolves.toEqual({});

    expect(insertText).toHaveBeenCalledWith("First.\n\nSecond.");
    expect(requestGuestFocus).not.toHaveBeenCalled();
    expect(wcSendCommand).not.toHaveBeenCalled();
  });

  it("hands a key to the guest's own widget without asking for focus", async () => {
    const { entries, requestGuestFocus, sendInputEvent, wcSendCommand } =
      makeUnfocusedEntry();

    await dispatch({
      entries,
      method: "Input.dispatchKeyEvent",
      params: { code: "Enter", key: "Enter", text: "\r", type: "keyDown" },
      requestGuestFocus,
    });

    expect(sendInputEvent.mock.calls).toEqual([
      [{ keyCode: "Enter", modifiers: [], type: "keyDown" }],
      [{ keyCode: "\r", modifiers: [], type: "char" }],
    ]);
    expect(requestGuestFocus).not.toHaveBeenCalled();
    expect(wcSendCommand).not.toHaveBeenCalled();
  });

  it.each<[string, { seen?: number; where?: string }, string, object]>([
    [
      "a cross-origin frame the page does not name",
      { where: "frame" },
      "Input.insertText",
      { text: "hello" },
    ],
    [
      "text with no field to go into",
      { where: "none" },
      "Input.insertText",
      { text: "hello" },
    ],
    [
      "a commit the page fired no input event for",
      { seen: 0 },
      "Input.insertText",
      { text: "hello" },
    ],
    [
      "a Control chord",
      {},
      "Input.dispatchKeyEvent",
      { code: "KeyA", key: "a", modifiers: 2, type: "keyDown" },
    ],
    [
      "IME composition",
      {},
      "Input.imeSetComposition",
      { selectionEnd: 1, selectionStart: 1, text: "あ" },
    ],
  ])("takes focus for %s", async (_, page, method, params) => {
    const {
      entries,
      insertText,
      requestGuestFocus,
      sendInputEvent,
      wcSendCommand,
    } = makeUnfocusedEntry(page);

    await dispatch({ entries, method, params, requestGuestFocus });

    expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
    expect(wcSendCommand).toHaveBeenCalledWith(
      method,
      expect.objectContaining(params),
    );
    expect(sendInputEvent).not.toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledTimes(page.seen === 0 ? 1 : 0);
  });

  it("sends text once when the page does not say whether it fired an input event", async () => {
    const { entries, insertText, requestGuestFocus, wcSendCommand } =
      makeUnfocusedEntry({ seen: Promise.reject(new Error("page busy")) });
    vi.spyOn(log, "info").mockImplementation(noop);

    await expect(
      dispatch({
        entries,
        method: "Input.insertText",
        params: { text: "hello" },
        requestGuestFocus,
      }),
    ).resolves.toEqual({});

    expect(insertText).toHaveBeenCalledOnce();
    expect(requestGuestFocus).not.toHaveBeenCalled();
    expect(wcSendCommand).not.toHaveBeenCalled();
  });

  it("asks the window whether the guest holds focus, past a page that claims it", async () => {
    const { entries, insertText, requestGuestFocus, wcSendCommand } =
      makeUnfocusedEntry();
    const wc = entries.get(TARGET_ID)!
      .webContents as unknown as FakeWebContents;
    // The page says it has focus: under focus emulation it always does, and a
    // script can redefine document.hasFocus.
    wc.executeJavaScript.mockResolvedValue(true);
    wc.executeJavaScriptInIsolatedWorld = vi
      .fn()
      .mockImplementation((_world: number, [{ code }]: [{ code: string }]) =>
        Promise.resolve(
          code === "document.hasFocus()"
            ? true
            : code.includes(".seen()")
              ? 2
              : code.includes(".handled()")
                ? "keypress"
                : "armed",
        ),
      );

    await dispatch({
      entries,
      method: "Input.insertText",
      params: { text: "hello" },
      requestGuestFocus,
    });

    expect(insertText).toHaveBeenCalledWith("hello");
    expect(wcSendCommand).not.toHaveBeenCalled();
    expect(requestGuestFocus).not.toHaveBeenCalled();
  });

  it("takes focus for a cross-origin frame with no session of its own, saying so", async () => {
    const { entries, requestGuestFocus, wcSendCommand } = makeUnfocusedEntry({
      where: "frame",
    });
    const info = vi.spyOn(log, "info").mockImplementation(noop);
    // Same site, another origin: in the page's process, so no target.
    wcSendCommand.mockImplementation((method: string) =>
      Promise.resolve(
        method === "Runtime.evaluate"
          ? { result: { objectId: "owner" } }
          : method === "DOM.describeNode"
            ? { node: { frameId: "FRAME-9" } }
            : {},
      ),
    );

    await dispatch({
      entries,
      method: "Input.insertText",
      params: { text: "hello" },
      requestGuestFocus,
    });

    expect(requestGuestFocus).toHaveBeenCalledWith(TARGET_ID);
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /takes focus .*focus in a frame with no debugger session$/,
      ),
    );
  });

  it("types into a field in a frame of its own on that frame's session", async () => {
    const { entries, requestGuestFocus, wcSendCommand } = makeUnfocusedEntry({
      where: "frame",
    });
    entries.get(TARGET_ID)!.frameSessions.set("FRAME-1", "frame-session-1");
    // The page's focus is on the frame's owner; inside the frame, on a field.
    wcSendCommand.mockImplementation(
      (method: string, _params: unknown, session?: string) =>
        Promise.resolve(
          method === "Runtime.evaluate"
            ? { result: session ? { subtype: "null" } : { objectId: "owner" } }
            : method === "DOM.describeNode"
              ? { node: { frameId: "FRAME-1" } }
              : {},
        ),
    );

    await dispatch({
      entries,
      method: "Input.insertText",
      params: { text: "4242 4242 4242 4242" },
      requestGuestFocus,
    });

    expect(wcSendCommand).toHaveBeenCalledWith(
      "Input.insertText",
      { text: "4242 4242 4242 4242" },
      "frame-session-1",
    );
    expect(requestGuestFocus).not.toHaveBeenCalled();
  });

  it("keeps the session of each frame the debugger attaches in a process of its own", () => {
    const entry = makeEntry();
    const attached = (sessionId: string, targetId: string, type: string) =>
      noteFrameSession(entry, "Target.attachedToTarget", {
        sessionId,
        targetInfo: { targetId, type },
      });

    attached("frame-session-1", "FRAME-1", "iframe");
    attached("worker-session", "WORKER-1", "worker");
    attached("frame-session-2", "FRAME-2", "iframe");
    noteFrameSession(entry, "Target.detachedFromTarget", {
      sessionId: "frame-session-1",
    });

    expect([...entry.frameSessions]).toEqual([["FRAME-2", "frame-session-2"]]);
  });

  it("sends a frame's keys on its own session, with no focus check", async () => {
    const { entries, requestGuestFocus, wcSendCommand } = makeUnfocusedEntry();
    const host = (
      entries.get(TARGET_ID)!.webContents as unknown as FakeWebContents
    ).hostWebContents!;

    await dispatch({
      entries,
      frameSession: "frame-session-1",
      method: "Input.insertText",
      params: { text: "4242" },
      requestGuestFocus,
    });

    expect(wcSendCommand).toHaveBeenCalledWith(
      "Input.insertText",
      { text: "4242" },
      "frame-session-1",
    );
    expect(requestGuestFocus).not.toHaveBeenCalled();
    expect(
      host.executeJavaScript.mock.calls.some(([code]) => isKeyboardProbe(code)),
    ).toBe(false);
  });
});

describe("a frame in a process of its own", () => {
  const FRAME = "frame-session-1";
  const quads = (y: number) => ({
    quads: [[0, y, 10, y, 10, y + 10, 0, y + 10]],
  });

  it("sends the frame's command to the frame's session", async () => {
    const wcSendCommand = vi.fn().mockResolvedValue({ result: {} });
    const entry = makeEntry({ sendCommand: wcSendCommand });

    await dispatch({
      entries: new Map([[TARGET_ID, entry]]),
      frameSession: FRAME,
      method: "Accessibility.getFullAXTree",
      params: {},
    });

    expect(wcSendCommand).toHaveBeenCalledWith(
      "Accessibility.getFullAXTree",
      {},
      FRAME,
    );
  });

  it.each(cdpMethodsHandled("main", "override"))(
    "refuses %s, which main answers for the whole tab",
    async (method) => {
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entry = makeEntry({ sendCommand: wcSendCommand });

      await expect(
        dispatch({
          entries: new Map([[TARGET_ID, entry]]),
          frameSession: FRAME,
          method,
          params: {},
        }),
      ).rejects.toThrow(/works on the whole tab, not inside a frame/);
      expect(wcSendCommand).not.toHaveBeenCalled();
    },
  );

  // A press is checked against the last measurement only when both went to
  // the same frame, since each is in that frame's own coordinates.
  it.each([
    {
      label: "refuses a moved element's press in the frame that measured it",
      measuredIn: FRAME,
      refused: true,
    },
    {
      label: "sends a frame's press as it came after a measurement of the page",
      measuredIn: undefined,
      refused: false,
    },
  ])("$label", async ({ measuredIn, refused }) => {
    const answers: unknown[] = [quads(393), quads(356)];
    const wcSendCommand = vi
      .fn()
      .mockImplementation((method: string) =>
        Promise.resolve(
          method === "DOM.getContentQuads" ? answers.shift() : {},
        ),
      );
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const entries = new Map([[TARGET_ID, entry]]);
    const send = (method: string, params: unknown, frameSession?: string) =>
      dispatch({
        entries,
        frameSession,
        method,
        params,
      });
    const click = { button: "left", clickCount: 1, x: 5, y: 398 };

    await send("DOM.getContentQuads", { backendNodeId: 7 }, measuredIn);
    const press = send(
      "Input.dispatchMouseEvent",
      { ...click, type: "mousePressed" },
      FRAME,
    );
    if (refused) {
      await expect(press).rejects.toThrow(/element moved/);
    } else {
      await press;
    }

    expect(
      wcSendCommand.mock.calls.filter(([m]) => m === "DOM.getContentQuads"),
    ).toEqual(
      measuredIn
        ? [0, 1].map(() => [
            "DOM.getContentQuads",
            { backendNodeId: 7 },
            measuredIn,
          ])
        : [["DOM.getContentQuads", { backendNodeId: 7 }]],
    );
    expect(
      wcSendCommand.mock.calls.filter(
        ([m]) => m === "Input.dispatchMouseEvent",
      ),
    ).toEqual(
      refused
        ? []
        : [
            [
              "Input.dispatchMouseEvent",
              { ...click, type: "mousePressed" },
              FRAME,
            ],
          ],
    );
  });
});

describe("the table of CDP methods", () => {
  it("lists exactly the commands main answers without the debugger", () => {
    expect(Object.keys(MAIN_OVERRIDES).toSorted()).toEqual(
      cdpMethodsHandled("main", "override").toSorted(),
    );
  });

  it("lists exactly the commands main refuses", () => {
    expect(Object.keys(MAIN_REFUSALS).toSorted()).toEqual(
      cdpMethodsHandled("main", "refuse").toSorted(),
    );
  });

  it.each([undefined, "frame-session-1"])(
    "refuses the commands that would freeze or blur a tab, with frame session %s",
    async (frameSession) => {
      const wcSendCommand = vi.fn().mockResolvedValue({});
      const entries = new Map([
        [TARGET_ID, makeEntry({ sendCommand: wcSendCommand })],
      ]);

      await expect(
        dispatch({
          entries,
          frameSession,
          method: "Page.setWebLifecycleState",
          params: { state: "frozen" },
        }),
      ).rejects.toThrow(/cannot be frozen/);
      await expect(
        dispatch({
          entries,
          frameSession,
          method: "Emulation.setFocusEmulationEnabled",
          params: { enabled: false },
        }),
      ).rejects.toThrow(/stays live/);
      expect(wcSendCommand).not.toHaveBeenCalled();
    },
  );

  it("warns once about a command it does not know, and still sends it on", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(noop);
    const wcSendCommand = vi.fn().mockResolvedValue({ ok: true });
    const entry = makeEntry({ sendCommand: wcSendCommand });
    const entries = new Map([[TARGET_ID, entry]]);
    const send = () =>
      dispatch({
        entries,
        method: "Animation.enable",
        params: {},
      });

    await send();
    await send();

    expect(wcSendCommand).toHaveBeenCalledTimes(2);
    expect(
      warn.mock.calls.filter(([line]) =>
        String(line).includes("Animation.enable"),
      ),
    ).toHaveLength(1);
    warn.mockRestore();
  });
});
