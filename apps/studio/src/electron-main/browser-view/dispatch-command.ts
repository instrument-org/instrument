import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { type BrowserTargetId } from "@instrument-org/workspace/electron";

import type { BrowserEntry } from "./entry";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";
import { applyDownloadBehavior } from "./downloads";
import { log } from "./log";
import { handlePrintToPDF } from "./print-to-pdf";
import { startScreencast, stopScreencast } from "./screencast";

export async function sendCommand({
  ensureDebuggerAttached,
  entries,
  method,
  params,
  targetId,
}: {
  ensureDebuggerAttached: (entry: BrowserEntry) => void;
  entries: Map<BrowserTargetId, BrowserEntry>;
  method: string;
  params: unknown;
  targetId: BrowserTargetId;
}): Promise<unknown> {
  const entry = entries.get(targetId);
  if (!entry) {
    log.error(
      `sendCommand: target not found targetId=${targetId} method=${method}`,
    );
    throw new Error(`Browser target not found: ${targetId}`);
  }

  ensureDebuggerAttached(entry);

  if (method === "Page.printToPDF") {
    return await handlePrintToPDF(entry, params);
  }

  // Electron's debugger does not expose Page.startScreencast / stopScreencast.
  // Emulate them by polling webContents.capturePage() and emitting synthetic
  // Page.screencastFrame events into the event listener set.
  if (method === "Page.startScreencast") {
    const p = (params ?? {}) as Protocol.Page.StartScreencastRequest;
    startScreencast({
      entry,
      format: p.format ?? "jpeg",
      maxHeight: p.maxHeight ?? 720,
      maxWidth: p.maxWidth ?? 1280,
      quality: p.quality ?? 80,
    });
    return {};
  }

  if (method === "Page.stopScreencast") {
    stopScreencast(entry);
    return {};
  }

  // screencastFrameAck is a flow-control signal back to the browser; since
  // we drive the capture loop ourselves we can silently acknowledge it.
  if (method === "Page.screencastFrameAck") {
    return {};
  }

  if (method === "Page.captureScreenshot") {
    const p = (params ?? {}) as Protocol.Page.CaptureScreenshotRequest;
    // Full-page capture (captureBeyondViewport) isn't supported on the `<webview>`
    // guest: its compositor surface is pinned to the viewport, so Chromium fills an
    // over-viewport clip by tiling the top of the page (growing the element grows
    // layout but not the rasterized surface). Rather than return a misleading
    // viewport crop or a tiled image, fail with a message pointing the agent at PDF
    // capture, which renders the whole document via the print path and works here.
    if (p.captureBeyondViewport === true) {
      throw new Error(
        "Full-page screenshots are not supported in this browser. To capture the full height of the page, export it to PDF instead: `agent-browser pdf <path>`.",
      );
    }
    // Plain viewport capture (no clip) -- the shape the recorder polls at 10fps and
    // `screenshot` uses. capturePage reads the paint-host guest's live surface,
    // which the debugger's fromSurface screenshot can't when the window is
    // occluded. Element clips (a clip without beyond-viewport) still use real CDP.
    if (!p.clip) {
      return await captureViewportScreenshot(entry, p);
    }
  }

  if (method === "Browser.getWindowForTarget") {
    return getWindowForTargetStub();
  }

  // Browser.setContentsSize is an experimental CDP command that resizes the
  // host window's content area to match the emulated viewport. Electron has no
  // implementation of this command, and we must not resize the Studio window.
  // agent-browser calls it as best-effort after Emulation.setDeviceMetricsOverride
  // (which does work); the screencast path it is intended to align doesn't apply
  // to our capturePage-based emulated screencast. Stub it out silently.
  if (method === "Browser.setContentsSize") {
    return {};
  }

  // Electron does not support CDP browser context management. Track the
  // authorized path per-target; the will-download handler in downloads.ts
  // applies it via item.setSavePath. session.setDownloadPath is avoided
  // because it is session-wide and would collide across concurrent targets.
  if (method === "Browser.setDownloadBehavior") {
    return applyDownloadBehavior(entry, params);
  }

  // Device emulation (Emulation.setDeviceMetricsOverride) isn't supported for
  // agent-browser, for the same underlying reason captureBeyondViewport isn't
  // (above): this guest's compositor can't reliably rasterize a layout much
  // larger than its actual on-screen size. Two different attempts at making
  // an override "safe" (scaling it to fit the panel, then routing capture
  // through real CDP instead of capturePage()) each traded the corruption for
  // a different one -- capturePage() painted only a corner of the emulated
  // layout and left the rest transparent; real CDP capture at the full
  // emulated size hit Chromium's own tiling limitation and returned the
  // page's content repeated in a grid instead of laid out once. Refuse it
  // outright rather than keep chasing new failure modes; agents needing a
  // larger capture should use PDF export instead (see above). The browser
  // panel's own device-preview menu (device-emulation.ts) is unaffected: it
  // only offers a few bounded, real device sizes, which don't provoke this.
  if (method === "Emulation.setDeviceMetricsOverride") {
    throw new Error(
      "Device/viewport emulation is not supported in this browser. The guest always renders at its on-screen panel size; to capture more than what's visible, export to PDF instead: `agent-browser pdf <path>`.",
    );
  }

  try {
    const wc = entry.webContents;
    if (!wc) {
      throw new Error("webContents unavailable");
    }

    // Pass-through: BrowserConfig.sendCommand is a string-keyed bridge from
    // an out-of-process Rust client (agent-browser), so we cannot type the
    // method here.
    //
    // 5s covers all normal commands on a live renderer; stuck renderers fail
    // fast so agent-browser gets a real error instead of a 30s silent hang.
    // Screenshot and evaluate get 20s: the compositor may not have a frame
    // ready post-navigation, and awaitPromise evals run real user JS.
    const SLOW_COMMANDS = new Set([
      "Page.captureScreenshot",
      "Runtime.evaluate",
    ]);
    // Input.dispatchMouseEvent is known to hang when the compositor thread is
    // blocked (e.g. during or just after navigation) -- the event fires but
    // Chromium never sends the CDP ack until the compositor unblocks. Tap
    // gestures go through the same path. Keyboard and scroll commands are
    // less likely to hang but share the same 5s budget.
    const MOUSE_COMMANDS = new Set<
      Extract<
        keyof ProtocolMapping.Commands,
        "Input.dispatchMouseEvent" | "Input.synthesizeTapGesture"
      >
    >(["Input.dispatchMouseEvent", "Input.synthesizeTapGesture"]);
    const timeoutMs = SLOW_COMMANDS.has(method) ? 20_000 : 5000;
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const result = await Promise.race([
      wc.debugger.sendCommand(method, params),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          // Cast is safe: has() is a runtime membership check against a fixed string set
          const isMouse = MOUSE_COMMANDS.has(
            method as "Input.dispatchMouseEvent" | "Input.synthesizeTapGesture",
          );
          const detail = isMouse
            ? `CDP command timed out: ${method}. The page is not responding to click/tap events -- this is a known Chromium behavior when the compositor thread is blocked (e.g. the page is still loading or is unresponsive). Try navigating directly to a URL instead of clicking, or ask the user to reload the app if the problem persists.`
            : `CDP command timed out: ${method}. The browser tab is not responding. The page may be unresponsive or still loading. Try navigating directly to a URL or ask the user to reload the app if the problem persists.`;
          reject(new Error(detail));
        }, timeoutMs),
      ),
    ]);
    return result;
  } catch (error) {
    log.error(
      `sendCommand error targetId=${targetId} method=${method} error=${String(error)}`,
    );
    throw error;
  }
}

// Serve a viewport Page.captureScreenshot from webContents.capturePage instead
// of the debugger. The paint-host guest is always composited (visibility:visible
// in a visible window), so capturePage reads its live surface; the debugger's
// fromSurface screenshot would instead block on a compositor frame when the
// whole window is occluded/minimized. Plain capturePage (no stayHidden) lets
// Electron force a frame if the window is hidden, matching the app's other
// capture paths. Throws fast on timeout/empty so the recorder skips a frame
// rather than the caller hanging.
async function captureViewportScreenshot(
  entry: BrowserEntry,
  p: Protocol.Page.CaptureScreenshotRequest,
): Promise<Protocol.Page.CaptureScreenshotResponse> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    throw new Error("webContents unavailable");
  }
  const CAPTURE_TIMEOUT_MS = 5000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const image = await Promise.race([
    wc.capturePage(),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error("capturePage timed out"));
      }, CAPTURE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
  if (image.isEmpty()) {
    throw new Error("capturePage returned an empty frame");
  }
  const data =
    p.format === "jpeg"
      ? image.toJPEG(p.quality ?? 80).toString("base64")
      : image.toPNG().toString("base64");
  return { data };
}

// Electron's debugger does not implement the Browser domain. agent-browser
// probes Browser.getWindowForTarget to discover window dimensions; return
// a fixed stub matching our DEFAULT_VIEWPORT so callers can size relative
// to the agent's logical viewport without hitting an error log per session.
function getWindowForTargetStub(): Protocol.Browser.GetWindowForTargetResponse {
  return {
    bounds: {
      height: DEFAULT_VIEWPORT_HEIGHT,
      left: 0,
      top: 0,
      width: DEFAULT_VIEWPORT_WIDTH,
      windowState: "normal",
    },
    windowId: 1,
  };
}
