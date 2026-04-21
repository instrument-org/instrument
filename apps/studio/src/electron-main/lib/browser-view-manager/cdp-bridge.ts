import type { Protocol } from "devtools-protocol";

import type { BrowserEntry } from "./entry";

import { sendCdpCommand } from "../cdp";
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
  entries: Map<string, BrowserEntry>;
  method: string;
  params: unknown;
  targetId: string;
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
    const rescaled = await rescaleFullPageScreenshotClip(entry, params);
    if (rescaled) {
      return rescaled;
    }
  }

  if (method === "Browser.getWindowForTarget") {
    return getWindowForTargetStub();
  }

  // Electron does not support CDP browser context management. Track the
  // authorized path per-target; the will-download handler in downloads.ts
  // applies it via item.setSavePath. session.setDownloadPath is avoided
  // because it is session-wide and would collide across concurrent targets.
  if (method === "Browser.setDownloadBehavior") {
    return applyDownloadBehavior(entry, params);
  }

  try {
    const wc = entry.view.webContents;
    if (!wc) {
      throw new Error("webContents unavailable");
    }
    // Pass-through: BrowserConfig.sendCommand is a string-keyed bridge from
    // an out-of-process Rust client (agent-browser), so we cannot type the
    // method here. Typed call sites use sendCdpCommand directly above.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await wc.debugger.sendCommand(method, params);
    return result;
  } catch (error) {
    log.error(
      `sendCommand error targetId=${targetId} method=${method} error=${String(error)}`,
    );
    throw error;
  }
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

// FP-922: agent-browser builds its full-page clip from contentSize (device
// pixels) at scale: 1.0. Embedded in a HiDPI host window, Electron's layout
// metrics report contentSize = dsf * cssContentSize regardless of Emulation
// overrides (the override only affects window.devicePixelRatio, not
// Page.getLayoutMetrics). That makes both the clip rectangle AND the
// resulting PNG 2x too large in each axis: the document is painted in the
// top half and the area below contentHeight is rendered as a second tiled
// paint. Convert the clip to CSS px so it matches actual document bounds.
// Returns the rewritten capture result, or null to fall through to the
// default debugger.sendCommand path.
async function rescaleFullPageScreenshotClip(
  entry: BrowserEntry,
  params: unknown,
): Promise<null | Protocol.Page.CaptureScreenshotResponse> {
  const p = (params ?? {}) as Protocol.Page.CaptureScreenshotRequest;
  if (p.captureBeyondViewport !== true || !p.clip) {
    return null;
  }
  const wc = entry.view.webContents;
  if (!wc || wc.isDestroyed() || !wc.debugger.isAttached()) {
    return null;
  }
  try {
    // We rely on the deprecated contentSize specifically: it reports the
    // scrollable area in device pixels as Electron's CDP layer sees it,
    // which is the exact scale agent-browser inherits when it builds its
    // clip from the same field. Comparing against cssContentSize is the
    // only reliable way to recover that effective DSF (host display
    // scaleFactor and Emulation overrides don't match it in practice).
    // The cast strips the @deprecated marker from contentSize since we have
    // no non-deprecated equivalent for this diagnostic.
    const metrics = (await sendCdpCommand(wc, "Page.getLayoutMetrics")) as Omit<
      Protocol.Page.GetLayoutMetricsResponse,
      "contentSize"
    > & {
      contentSize: Protocol.DOM.Rect;
    };
    const dpW = metrics.contentSize.width;
    const cssW = metrics.cssContentSize.width;
    const dsf = cssW > 0 ? dpW / cssW : 1;
    if (dsf === 1) {
      return null;
    }
    const newClip: Protocol.Page.Viewport = {
      height: Math.round(p.clip.height / dsf),
      scale: p.clip.scale,
      width: Math.round(p.clip.width / dsf),
      x: Math.round(p.clip.x / dsf),
      y: Math.round(p.clip.y / dsf),
    };
    return await sendCdpCommand(wc, "Page.captureScreenshot", {
      ...p,
      clip: newClip,
    });
  } catch (error) {
    log.warn(
      `captureScreenshot rescale failed targetId=${entry.targetId} err=${String(error)}`,
    );
    return null;
  }
}
