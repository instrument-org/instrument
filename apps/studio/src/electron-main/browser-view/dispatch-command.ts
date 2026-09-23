import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import type { WebContents } from "electron";

import {
  type BrowserTargetId,
  CdpCommandTimeoutError,
} from "@instrument-org/workspace/electron";
import { noop, sleep } from "radashi";

import type { BrowserEntry } from "./entry";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";
import { applyDownloadBehavior } from "./downloads";
import {
  clearGuestSurface,
  getEffectiveGuestSurface,
  requestGuestSurface,
} from "./guest-surface";
import { log } from "./log";
import { withMacEditingCommands } from "./mac-editing-commands";
import { withoutMacNativeKeyCode } from "./mac-native-key-code";
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

// How long the host waits on any one question it asks the guest around a
// command (is it rendering, what is under the press, where is the element
// now). A timer inside the guest cannot bound these: a page whose main thread
// is blocked never runs it, so the wait is bounded here.
const GUEST_PROBE_TIMEOUT_MS = 1000;

// The measurement agent-browser took of the element it is about to click,
// kept briefly so the press that follows can be checked against it.
const lastMeasurement = new WeakMap<
  BrowserEntry,
  { at: number; method: string; params: unknown; result: unknown }
>();
const MEASUREMENT_FRESH_MS = 2000;
// Half a CSS pixel is rounding, not movement.
const MOVED_PX = 0.5;

export async function sendCommand({
  describeHost,
  ensureDebuggerAttached,
  entries,
  method,
  params,
  requestGuestFocus,
  targetId,
}: {
  // Whether the user could see the guest: its window's state and whether its
  // tab is shown or parked. Absent in tests; the press log then omits it.
  describeHost?: (targetId: BrowserTargetId) => Promise<string>;
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
    return getWindowForTargetStub(targetId);
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

  // A guest that is not rendering (Studio hidden, minimized, or covered by
  // other windows) never acknowledges a press, so the command would hang until
  // the timeout below and read as a slow page. Refuse up front and say why.
  if (method.startsWith("Input.") && !(await guestIsRendering(entry, method))) {
    log.warn(
      `refused ${method} targetId=${targetId}: page is not rendering ${(await describeHost?.(targetId)) ?? ""}`,
    );
    throw new Error(
      "Input was not delivered: the Instrument window is hidden, minimized, or covered by other windows, so this page is not rendering and cannot receive clicks, taps, or key presses. Reading it (snapshot, get text, eval, screenshot) still works. Ask the user to bring the Instrument window into view, then retry.",
    );
  }

  // The press goes where the element was measured. If the page has moved it
  // since, the press would land on whatever took its place and still report
  // success, so measure once more and refuse a press that would miss.
  // One line per press saying what was under the point and whether the user
  // could see the page, so a click that did nothing can be told apart from one
  // that landed somewhere else or on a page nobody was looking at.
  let press: null | { at: number; context: string } = null;
  if (method === "Input.dispatchMouseEvent" && isPress(params)) {
    await refusePressThatWouldMiss(entry, params);
    press = {
      at: Date.now(),
      context: await describePress(entry, params, describeHost),
    };
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
    // ready post-navigation, and awaitPromise evals run real user JS. Navigate
    // gets 20s too: Electron answers it at commit, so a server slow to send its
    // first byte holds the answer that long while the navigation carries on.
    const SLOW_COMMANDS = new Set([
      "Page.captureScreenshot",
      "Page.navigate",
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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const result = await Promise.race([
      wc.debugger.sendCommand(
        method,
        withMacEditingCommands(method, withoutMacNativeKeyCode(method, params)),
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          // Cast is safe: has() is a runtime membership check against a fixed string set
          const isMouse = MOUSE_COMMANDS.has(
            method as "Input.dispatchMouseEvent" | "Input.synthesizeTapGesture",
          );
          const detail = isMouse
            ? `CDP command timed out: ${method}. The page did not acknowledge the input within 5s; it may still be loading or be unresponsive. Take a snapshot to see its current state before retrying.`
            : `CDP command timed out: ${method}. The browser tab is not responding. The page may be unresponsive or still loading. Try navigating directly to a URL or ask the user to reload the app if the problem persists.`;
          reject(new CdpCommandTimeoutError(method, detail));
        }, timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(timeout);
    });
    if (press) {
      log.info(
        `agent press targetId=${targetId} ${press.context} ack=${Date.now() - press.at}ms`,
      );
    }
    // agent-browser measures an element straight after scrolling it into view
    // and clicks the point it measured. Pages reflow in response to a scroll a
    // frame or two later (a sticky header or a collapsing table of contents
    // observing it), which moves the element before the press arrives and
    // lands the click on whatever took its place. Answering the scroll only
    // once the element's box has held still makes the measurement that follows
    // see the settled layout.
    if (method === "DOM.getBoxModel") {
      lastMeasurement.set(entry, { at: Date.now(), method, params, result });
    }
    if (method === "DOM.scrollIntoViewIfNeeded") {
      await remeasureUntilStable(
        wc,
        "DOM.getBoxModel",
        params,
        await wc.debugger.sendCommand("DOM.getBoxModel", params).catch(noop),
      );
    }
    // Selector and `find` clicks scroll and measure inside one script, so the
    // reflow cannot be waited out between the two; run it again until two runs
    // agree and answer with that measurement. The script finds the same
    // element and scrolls only when it is out of view, so a repeat moves
    // nothing that has already settled.
    if (measuresAfterScrolling(method, params)) {
      const settled = await remeasureUntilStable(wc, method, params, result);
      lastMeasurement.set(entry, {
        at: Date.now(),
        method,
        params,
        result: settled,
      });
      return settled;
    }
    return result;
  } catch (error) {
    if (press) {
      log.warn(
        `agent press targetId=${targetId} ${press.context} ack=failed after ${Date.now() - press.at}ms`,
      );
    }
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
// agent-browser probes this to discover its window's dimensions, and Electron's
// debugger has no Browser domain to answer it. Report what the guest is laid out
// at rather than a constant: it moves whenever an agent asks for a viewport, and
// again if the window shrinks under one and the pool clamps to what it can
// rasterize, so a fixed answer goes stale the first time either happens. Falls
// back to the default only before the renderer has reported a size.
function getWindowForTargetStub(
  targetId: BrowserTargetId,
): Protocol.Browser.GetWindowForTargetResponse {
  const surface = getEffectiveGuestSurface(targetId);
  return {
    bounds: {
      height: surface?.height ?? DEFAULT_VIEWPORT_HEIGHT,
      left: 0,
      top: 0,
      width: surface?.width ?? DEFAULT_VIEWPORT_WIDTH,
      windowState: "normal",
    },
    windowId: 1,
  };
}

function isPress(params: unknown): boolean {
  return (params as undefined | { type?: unknown })?.type === "mousePressed";
}

// agent-browser's script that scrolls an element into view and returns the
// point to click, recognized by the overlay check it carries. It measures in
// the same task that scrolled, before the page has reacted to the scroll.
function measuresAfterScrolling(method: string, params: unknown): boolean {
  const p = (params ?? {}) as {
    expression?: unknown;
    functionDeclaration?: unknown;
  };
  const source =
    method === "Runtime.evaluate"
      ? p.expression
      : method === "Runtime.callFunctionOn"
        ? p.functionDeclaration
        : undefined;
  return (
    typeof source === "string" &&
    source.includes("scrollIntoView") &&
    source.includes("blockerAt")
  );
}

// The point a measurement says to click: the centre of a box model's content
// quad, or the point agent-browser's scroll-and-measure script returned.
function pointOf(result: unknown): null | { x: number; y: number } {
  const r = result as null | {
    model?: { content?: number[] };
    result?: { value?: { x?: unknown; y?: unknown } };
  };
  const [x1, y1, x2, y2, x3, y3, x4, y4] = r?.model?.content ?? [];
  if (
    x1 !== undefined &&
    y1 !== undefined &&
    x2 !== undefined &&
    y2 !== undefined &&
    x3 !== undefined &&
    y3 !== undefined &&
    x4 !== undefined &&
    y4 !== undefined
  ) {
    return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 };
  }
  const value = r?.result?.value;
  if (typeof value?.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }
  return null;
}

async function refusePressThatWouldMiss(entry: BrowserEntry, params: unknown) {
  const wc = entry.webContents;
  const measured = lastMeasurement.get(entry);
  lastMeasurement.delete(entry);
  if (!wc || !measured || Date.now() - measured.at > MEASUREMENT_FRESH_MS) {
    return;
  }
  const then = pointOf(measured.result);
  const press = params as { x?: number; y?: number };
  // Only a press aimed at the measured point is a click on that element.
  if (
    !then ||
    Math.abs((press.x ?? Number.NaN) - then.x) > MOVED_PX ||
    Math.abs((press.y ?? Number.NaN) - then.y) > MOVED_PX
  ) {
    return;
  }
  const now = pointOf(
    await withinGuestProbeTimeout(
      wc.debugger.sendCommand(measured.method, measured.params).catch(noop),
      noop,
    ),
  );
  if (
    now &&
    (Math.abs(now.x - then.x) > MOVED_PX || Math.abs(now.y - then.y) > MOVED_PX)
  ) {
    log.warn(
      `refused press targetId=${entry.targetId}: element moved from ${then.x},${then.y} to ${now.x},${now.y}`,
    );
    throw new Error(
      "The click was not sent: the page's layout shifted after the element was measured, so the press would have landed on whatever moved into its place. Run the same click again.",
    );
  }
}

// What the press is about to hit, as the guest's own hit test sees it: the
// element under the point and the nearest thing that acts on a click, which is
// `none` when the press would land on plain text.
const describeHitScript = (x: number, y: number) => `(() => {
  const name = (el) => el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") : "none";
  const hit = document.elementFromPoint(${x}, ${y});
  const target = hit?.closest("a[href], button, input, select, textarea, label, summary, [role=button], [role=link], [onclick]");
  return "hit=" + name(hit) + " target=" + name(target) + " visibility=" + document.visibilityState;
})()`;

async function describePress(
  entry: BrowserEntry,
  params: unknown,
  describeHost?: (targetId: BrowserTargetId) => Promise<string>,
): Promise<string> {
  const { x, y } = params as { x?: number; y?: number };
  if (typeof x !== "number" || typeof y !== "number") {
    return "at=unknown";
  }
  const wc = entry.webContents;
  const hit: Promise<unknown> = wc
    ? withinGuestProbeTimeout(
        wc.executeJavaScript(describeHitScript(x, y)),
        () => "hit=unknown",
      )
    : Promise.resolve(undefined);
  const [what, host] = await Promise.all([
    hit.then(String, () => "hit=unknown"),
    describeHost?.(entry.targetId).catch(() => "host=unknown"),
  ]);
  return [`at=${x},${y}`, what, host].filter(Boolean).join(" ");
}

// Rounds of "wait two frames, measure again" before settling for the latest
// answer, which an element that never stops moving gets, as before.
const MAX_REMEASURES = 5;

async function remeasureUntilStable(
  wc: WebContents,
  method: string,
  params: unknown,
  first: unknown,
): Promise<unknown> {
  let previous = first;
  for (let round = 0; round < MAX_REMEASURES; round++) {
    await waitForTwoFrames(wc);
    const current: unknown = await withinGuestProbeTimeout(
      wc.debugger.sendCommand(method, params).catch(noop),
      noop,
    );
    if (
      current === undefined ||
      JSON.stringify(current) === JSON.stringify(previous)
    ) {
      return current ?? previous;
    }
    previous = current;
  }
  return previous;
}

// Resolves after the guest has rendered two animation frames, which is when a
// layout reacting to a scroll has landed. A page that is not rendering never
// fires requestAnimationFrame, so a timer bounds the wait, and a failed probe
// is no reason to fail the command it follows.
const SETTLE_FRAMES_SCRIPT =
  "new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); setTimeout(resolve, 100); })";

async function waitForTwoFrames(wc: WebContents): Promise<void> {
  await withinGuestProbeTimeout(
    wc.executeJavaScript(SETTLE_FRAMES_SCRIPT).catch(noop),
    noop,
  );
}

// Whether the guest is producing frames, which is what input acknowledgement
// waits on. Its visibilityState is no guide: background throttling is off for
// guests, so a guest in a covered window reports "visible" while rendering
// nothing. A page that renders answers one animation frame well inside the
// probe's window. Fails open when the probe itself errors, and a passing answer
// is reused briefly so the move, press, and release of one click pay for it
// once.
const RENDERING_PROBE_SCRIPT =
  "new Promise((resolve) => { requestAnimationFrame(() => resolve(true)); setTimeout(() => resolve(false), 150); })";
const RENDERING_REUSE_MS = 1000;
const renderingSeenAt = new WeakMap<BrowserEntry, number>();

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

// A guest that does not answer the probe at all has a blocked main thread
// rather than a hidden window, and fails the command as unresponsive.
async function guestIsRendering(
  entry: BrowserEntry,
  method: string,
): Promise<boolean> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    return true;
  }
  const seenAt = renderingSeenAt.get(entry);
  if (seenAt !== undefined && Date.now() - seenAt < RENDERING_REUSE_MS) {
    return true;
  }
  let rendering: unknown;
  try {
    rendering = await withinGuestProbeTimeout(
      wc.executeJavaScript(RENDERING_PROBE_SCRIPT),
      () => {
        throw new CdpCommandTimeoutError(
          method,
          `CDP command timed out: ${method}. The page did not answer within ${GUEST_PROBE_TIMEOUT_MS / 1000}s, so the input was not sent; it may be unresponsive or still loading. Take a snapshot to see its current state before retrying.`,
        );
      },
    );
  } catch (error) {
    if (error instanceof CdpCommandTimeoutError) {
      throw error;
    }
    return true;
  }
  if (rendering === false) {
    renderingSeenAt.delete(entry);
    return false;
  }
  renderingSeenAt.set(entry, Date.now());
  return true;
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

// Settles with the guest's answer, or with what `onTimeout` gives once the
// host has waited GUEST_PROBE_TIMEOUT_MS; an answer arriving after that is
// ignored.
async function withinGuestProbeTimeout<T>(
  answer: Promise<T>,
  onTimeout: () => T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      answer,
      new Promise<T>((resolve, reject) => {
        timeout = setTimeout(() => {
          try {
            resolve(onTimeout());
          } catch (error) {
            reject(error);
          }
        }, GUEST_PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
