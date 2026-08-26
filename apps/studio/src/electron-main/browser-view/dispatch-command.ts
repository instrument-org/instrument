import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";

import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { sleep } from "radashi";

import type { BrowserEntry } from "./entry";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";
import { applyDownloadBehavior } from "./downloads";
import { clearGuestSurface, requestGuestSurface } from "./guest-surface";
import { log } from "./log";
import { withMacEditingCommands } from "./mac-editing-commands";
import { handlePrintToPDF } from "./print-to-pdf";
import { startScreencast, stopScreencast } from "./screencast";

// CDP commands that put text or key events into the page. Chromium routes
// keyboard input to the widget that holds keyboard focus, not to the
// WebContents whose debugger carried the command, and the guest is an inner
// WebContents of the Studio renderer. So when the host holds focus these are
// delivered to Studio's own UI instead of the page -- into whatever the user
// last clicked, with every newline arriving as an Enter the prompt input
// submits on. Mouse, scroll, and touch commands are routed by hit-testing
// against the target's own surface and stay in the guest either way.
const KEYBOARD_COMMANDS = new Set([
  "Input.dispatchKeyEvent",
  "Input.imeSetComposition",
  "Input.insertText",
]);

// A page busy enough not to answer this promptly is one we should not be
// typing into blind, so a timeout reads as "no focus" like any other failure.
const FOCUS_PROBE_TIMEOUT_MS = 1000;

// The focus request crosses to the renderer and back through a stream, so the
// guest does not hold focus the instant we ask. Poll briefly rather than
// sleeping a fixed amount, so the common case costs one extra probe.
const FOCUS_REPAIR_TIMEOUT_MS = 1000;
const FOCUS_REPAIR_POLL_MS = 50;

export async function sendCommand({
  ensureDebuggerAttached,
  entries,
  method,
  params,
  requestGuestFocus,
  targetId,
}: {
  ensureDebuggerAttached: (entry: BrowserEntry) => void;
  entries: Map<BrowserTargetId, BrowserEntry>;
  method: string;
  params: unknown;
  // Absent only in tests that do not exercise the repair; without it a guest
  // that has lost focus can only be refused, which is the safe direction.
  requestGuestFocus?: (targetId: BrowserTargetId) => void;
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

  // A viewport request resizes the guest element itself rather than overriding
  // device metrics. The guest's layout viewport follows its element size
  // exactly, so there is never a second, larger layout for the compositor to
  // fall short of -- which is what corrupted both earlier attempts at honoring
  // this command as a real override (see in-app-browser-device-emulation).
  // The size applies while the guest is parked; a panel showing the guest sizes
  // it to the panel, and the request takes over again once it parks. Sizes past
  // what this window can rasterize are refused rather than clamped, because a
  // clamped guest still reports the size it was asked for.
  if (method === "Emulation.setDeviceMetricsOverride") {
    const p = (params ??
      {}) as Protocol.Emulation.SetDeviceMetricsOverrideRequest;
    const requested = requestGuestSurface({
      size: { height: p.height, width: p.width },
      targetId,
    });
    if (!requested.ok) {
      throw new Error(requested.error);
    }
    return {};
  }

  // Not forwarded to the debugger: the guest was resized rather than emulated,
  // so there is no override to clear, and the panel clears its own preview when
  // it parks.
  if (method === "Emulation.clearDeviceMetricsOverride") {
    clearGuestSurface(targetId);
    return {};
  }

  if (
    KEYBOARD_COMMANDS.has(method) &&
    !(await guestHoldsKeyboardFocus(entry))
  ) {
    // The agent's commands arrive as separate tool calls seconds apart, and
    // host focus is handed back once a target goes quiet, so a guest the agent
    // clicked will normally have lost focus again by the time the keystrokes
    // for it arrive. Take focus back rather than refuse: the guest's own
    // activeElement survives, so this lands the keys on whatever was clicked.
    // Logged either way: together these say how often agent typing arrives at
    // a guest that has already handed focus back, which is the normal case
    // whenever Studio itself is the focused window.
    if (await repairGuestKeyboardFocus(entry, requestGuestFocus)) {
      log.info(`reclaimed keyboard focus for ${method} targetId=${targetId}`);
    } else {
      log.warn(
        `refused ${method} targetId=${targetId}: guest does not hold keyboard focus and could not reclaim it`,
      );
      throw new Error(
        "Keyboard input was not delivered: this browser tab does not hold keyboard focus, so the keystrokes would go to the desktop app's own window instead of the page. Click the element you want to type into first (e.g. `agent-browser click @e5`), then send the keys again.",
      );
    }
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
      wc.debugger.sendCommand(method, withMacEditingCommands(method, params)),
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

// Whether the guest currently holds Chromium's keyboard focus, which is the
// precondition for CDP keyboard input reaching it at all. Asked of the guest
// document rather than derived from our own bookkeeping: `webContents`
// focus state is unreliable for `<webview>` guests, and a page-level `focus()`
// call does not move focus across the process boundary, so only the guest can
// answer this. Fails closed on every error path.
async function guestHoldsKeyboardFocus(entry: BrowserEntry): Promise<boolean> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    return false;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const hasFocus: unknown = await Promise.race([
      wc.executeJavaScript("document.hasFocus()"),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, FOCUS_PROBE_TIMEOUT_MS);
      }),
    ]);
    return hasFocus === true;
  } catch {
    return false;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// Ask the renderer to focus the guest, then wait for the guest to agree that
// it holds focus. Returns false when no repair channel was supplied or the
// guest never took focus, which keeps the caller failing closed.
async function repairGuestKeyboardFocus(
  entry: BrowserEntry,
  requestGuestFocus?: (targetId: BrowserTargetId) => void,
): Promise<boolean> {
  if (!requestGuestFocus) {
    return false;
  }
  requestGuestFocus(entry.targetId);
  const deadline = Date.now() + FOCUS_REPAIR_TIMEOUT_MS;
  do {
    await sleep(FOCUS_REPAIR_POLL_MS);
    if (await guestHoldsKeyboardFocus(entry)) {
      return true;
    }
  } while (Date.now() < deadline);
  return false;
}
