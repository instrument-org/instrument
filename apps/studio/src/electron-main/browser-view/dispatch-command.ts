import type { Protocol } from "devtools-protocol";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping";
import { type NativeImage, nativeImage, type WebContents } from "electron";

import {
  type BrowserTargetId,
  CdpCommandTimeoutError,
  type CdpMethod,
  isKnownCdpMethod,
  runningScriptAskedFor,
  scriptStillRunningMessage,
} from "@instrument-org/workspace/electron";
import { noop, sleep } from "radashi";

import type { BrowserEntry } from "./entry";

import { showAgentCommand, withoutAgentPointer } from "./agent-pointer";
import { captureFrame, FrameNotDrawnError } from "./capture-frame";
import {
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./device-metrics";
import { applyDownloadBehavior } from "./downloads";
import {
  captureClip,
  documentClip,
  type ImageCodec,
} from "./element-screenshot";
import { whileEmbedderComposites } from "./embedder-draw";
import {
  clearGuestSurface,
  getEffectiveGuestSurface,
  requestGuestSurface,
} from "./guest-surface";
import { log } from "./log";
import { withMacEditingCommands } from "./mac-editing-commands";
import { withoutMacNativeKeyCode } from "./mac-native-key-code";
import { typeWithoutFocus } from "./keyboard-without-focus";
import { handlePrintToPDF } from "./print-to-pdf";
import {
  forgetRunningScript,
  keepRunningScript,
  type RunningScript,
  runningScript,
  ScriptStillRunningError,
} from "./running-scripts";
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

// What a screenshot that never got a frame most likely means. whileEmbedderComposites
// makes a covered window draw, so reaching this is rare, but when it happens the
// agent should read the page rather than retry the capture or blame the page.
const SCREENSHOT_NOT_DRAWN =
  "The page has not drawn a frame to capture, most likely because the Instrument window is covered by other windows or minimized. Reading it (snapshot, get text, eval) still works, so verify with those, or ask the user to bring the Instrument window into view and retry.";

// How long the host waits on any one question it asks the guest around a
// command (is it rendering, what is under the press, where is the element
// now). A timer inside the guest cannot bound these: a page whose main thread
// is blocked never runs it, so the wait is bounded here.
const GUEST_PROBE_TIMEOUT_MS = 1000;

// The element a press at `point` is meant for and where it was, kept briefly
// so the press that follows can be checked against it. It is the element
// agent-browser measured when it measured one (a click by ref), and otherwise
// the element under the pointer when the pointer was sent there.
const aimedElement = new WeakMap<
  BrowserEntry,
  {
    at: number;
    /**
     * Who named the element: agent-browser, in a `DOM.getContentQuads` of its
     * own, or the pointer arriving over it. The pointer's next arrival takes
     * the element under it afresh.
     */
    by: "agent-browser" | "pointer";
    frameSession: string | undefined;
    /** The `DOM.getContentQuads` params that name the element. */
    node: unknown;
    point: Point;
    quads: number[][];
  }
>();
const MEASUREMENT_FRESH_MS = 2000;
// Half a CSS pixel is rounding, not movement.
const MOVED_PX = 0.5;
// The handle on the element under the pointer is kept in the page until the
// next one replaces it.
const AIMED_OBJECT_GROUP = "instrument-aimed-element";

// What CDP answers when the frame, node or target a command named went away
// while it was in flight: an ad iframe swapped out, a page navigating, an
// element re-rendered. agent-browser retries or re-snapshots, so these are
// races in a live page rather than failures worth an error line each.
const NAVIGATION_RACE_ERRORS = [
  "Frame with the given frameId is not found",
  "target closed while handling command",
  "Inspected target navigated or closed",
  "Node is detached from document",
  "Could not find node with given id",
  "Could not compute box model",
  "Could not compute content quads",
];

function isNavigationRace(error: unknown): boolean {
  const message = String(error);
  return NAVIGATION_RACE_ERRORS.some((race) => message.includes(race));
}

export async function sendCommand({
  byAgent = true,
  describeHost,
  ensureDebuggerAttached,
  entries,
  frameSession,
  method,
  params,
  requestGuestFocus,
  targetId,
}: {
  /** Whether an agent sent the command, which the agent's pointer shows; main's own page loads come through here too. */
  byAgent?: boolean;
  // Whether the user could see the guest: its window's state and whether its
  // tab is shown or parked.
  describeHost: (targetId: BrowserTargetId) => Promise<string>;
  ensureDebuggerAttached: (entry: BrowserEntry) => void;
  entries: Map<BrowserTargetId, BrowserEntry>;
  /** The session of the frame the command is for, when it is for a frame in a process of its own rather than the page. */
  frameSession?: string;
  method: string;
  params: unknown;
  requestGuestFocus: (targetId: BrowserTargetId) => void;
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
  noteUnknownMethod(method);

  const send = (sentMethod: string, sentParams: unknown) =>
    forwardToDebugger({
      byAgent,
      describeHost,
      entry,
      frameSession,
      method: sentMethod,
      params: sentParams,
      requestGuestFocus,
      targetId,
    });
  const forward = () => send(method, params);
  const refusal = isKnownCdpMethod(method) ? MAIN_REFUSALS[method] : undefined;
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  const override = isKnownCdpMethod(method)
    ? MAIN_OVERRIDES[method]
    : undefined;
  // What main answers itself, it answers for the whole tab (its surface, its
  // size, its reload, its downloads), which a frame has none of its own.
  if (override && frameSession !== undefined) {
    throw new Error(
      `${method} works on the whole tab, not inside a frame. Send it to the tab itself.`,
    );
  }
  return override
    ? await override({ entry, forward, params, send, targetId })
    : await forward();
}

/** What an override is handed: the tab, the command's params, and the way on to the debugger. */
interface OverrideCall {
  entry: BrowserEntry;
  /** Sends the command on to the guest's debugger after all, for a shape the override leaves alone. */
  forward: () => Promise<unknown>;
  params: unknown;
  /** Sends the guest's debugger a command of the override's own, behind the checks every command gets there. */
  send: (method: string, params: unknown) => Promise<unknown>;
  targetId: BrowserTargetId;
}

/**
 * The commands main answers without the guest's debugger, each the way the
 * table of CDP methods (`cdp-methods.ts`) says; a test holds the two to the
 * same list.
 */
export const MAIN_OVERRIDES: {
  [M in CdpMethod]?: (call: OverrideCall) => unknown;
} = {
  // agent-browser probes this to discover its window's dimensions, and
  // Electron's debugger has no Browser domain to answer it.
  "Browser.getWindowForTarget": ({ targetId }) =>
    getWindowForTargetStub(targetId),

  // Browser.setContentsSize is an experimental CDP command that resizes the
  // host window's content area to match the emulated viewport. Electron has no
  // implementation of this command, and we must not resize the Studio window.
  // agent-browser calls it as best-effort after Emulation.setDeviceMetricsOverride
  // (which does work); the screencast path it is intended to align doesn't apply
  // to our capturePage-based emulated screencast. Stub it out silently.
  "Browser.setContentsSize": () => ({}),

  // Electron does not support CDP browser context management. Track the
  // authorized path per-target; the will-download handler in downloads.ts
  // applies it via item.setSavePath. session.setDownloadPath is avoided
  // because it is session-wide and would collide across concurrent targets.
  "Browser.setDownloadBehavior": ({ entry, params }) =>
    applyDownloadBehavior(entry, params),

  // Not forwarded to the debugger: the guest was resized rather than emulated,
  // so there is no override to clear, and the panel clears its own preview when
  // it parks.
  "Emulation.clearDeviceMetricsOverride": ({ targetId }) => {
    clearGuestSurface(targetId);
    return {};
  },

  // A viewport request resizes the guest element itself rather than overriding
  // device metrics. The guest's layout viewport follows its element size
  // exactly, so there is never a second, larger layout for the compositor to
  // fall short of -- which is what corrupted both earlier attempts at honoring
  // this command as a real override (see in-app-browser-device-emulation).
  // The size applies while the guest is parked; a panel showing the guest sizes
  // it to the panel, and the request takes over again once it parks. Sizes past
  // what this window can rasterize are refused rather than clamped, because a
  // clamped guest still reports the size it was asked for.
  "Emulation.setDeviceMetricsOverride": ({ entry, params, targetId }) => {
    const p = (params ??
      {}) as Protocol.Emulation.SetDeviceMetricsOverrideRequest;
    const requested = requestGuestSurface({
      hostId: entry.hostId,
      size: { height: p.height, width: p.width },
      targetId,
    });
    if (!requested.ok) {
      throw new Error(requested.error);
    }
    return {};
  },

  "Page.captureScreenshot": async ({
    entry,
    forward,
    params,
    send,
    targetId,
  }) => {
    const p = (params ?? {}) as Protocol.Page.CaptureScreenshotRequest;
    // agent-browser asks for an element (a selector or a ref) and for the
    // whole page (`--full`) the same way: beyond the viewport, with a clip in
    // document coordinates. Either is taken a viewport's worth at a time,
    // since the `<webview>` guest's compositor surface is pinned to the
    // viewport and Chromium fills a larger clip by repeating the first
    // viewport's worth.
    if (p.captureBeyondViewport === true) {
      // The debugger's answer, typed by the protocol rather than checked.
      const metrics = (await send(
        "Page.getLayoutMetrics",
        {},
      )) as Partial<Protocol.Page.GetLayoutMetricsResponse>;
      const viewport = metrics.cssLayoutViewport;
      const clip =
        p.clip ??
        (metrics.cssContentSize && documentClip(metrics.cssContentSize));
      if (!clip || !viewport) {
        throw new Error(
          "The page did not report its size, so nothing beyond the viewport could be captured. Capture the viewport with `agent-browser screenshot`, or export the page with `agent-browser pdf <path>`.",
        );
      }
      // A long page is many captures, each of which the guest has to draw:
      // counted on the entry so it is not put to sleep between two of them.
      entry.capturesRunning += 1;
      try {
        return await withoutAgentPointer(entry, () =>
          captureClip({
            codec: nativeImageCodec,
            pageZoom: entry.webContents?.getZoomFactor(),
            request: { ...p, clip },
            send: (request) => send("Page.captureScreenshot", request),
            viewport,
          }),
        );
      } finally {
        entry.capturesRunning -= 1;
      }
    }
    // A clip within the viewport is the debugger's to take as asked.
    if (p.clip) {
      return await withoutAgentPointer(entry, forward);
    }
    // Plain viewport capture (no clip) -- the shape the recorder polls at 10fps and
    // `screenshot` uses. capturePage reads the paint-host guest's live surface,
    // which the debugger's fromSurface screenshot can't when the window is
    // occluded.
    try {
      return await withoutAgentPointer(entry, () =>
        captureViewportScreenshot(entry, p),
      );
    } catch (error) {
      log.error(
        `sendCommand error targetId=${targetId} method=Page.captureScreenshot error=${String(error)}`,
      );
      throw error;
    }
  },

  "Page.printToPDF": ({ entry, params }) => handlePrintToPDF(entry, params),

  // A guest's debugger answers Page.reload by reloading the app window that
  // embeds it, which takes every tab and the guest itself with it. The guest's
  // own reload is what the panel's reload button calls, and stays in the tab.
  "Page.reload": ({ entry, params }) => {
    const guest = entry.webContents;
    if (!guest || guest.isDestroyed()) {
      throw new Error("webContents unavailable");
    }
    const p = (params ?? {}) as Protocol.Page.ReloadRequest;
    if (p.ignoreCache) {
      guest.reloadIgnoringCache();
    } else {
      guest.reload();
    }
    return {};
  },

  // screencastFrameAck is a flow-control signal back to the browser; since
  // we drive the capture loop ourselves we can silently acknowledge it.
  "Page.screencastFrameAck": () => ({}),

  // Electron's debugger does not expose Page.startScreencast / stopScreencast.
  // Emulate them by polling webContents.capturePage() and emitting synthetic
  // Page.screencastFrame events into the event listener set.
  "Page.startScreencast": ({ entry, params }) => {
    const p = (params ?? {}) as Protocol.Page.StartScreencastRequest;
    startScreencast({
      entry,
      format: p.format ?? "jpeg",
      maxHeight: p.maxHeight ?? 720,
      maxWidth: p.maxWidth ?? 1280,
      quality: p.quality ?? 80,
    });
    return {};
  },

  "Page.stopScreencast": ({ entry }) => {
    stopScreencast(entry);
    return {};
  },
};

/**
 * The commands main refuses, for the page and for a frame alike, each with
 * what the agent is told, as the table of CDP methods says; a test holds the
 * two to the same list.
 */
export const MAIN_REFUSALS: { [M in CdpMethod]?: string } = {
  // The manager keeps focus emulation on for the life of the debugger, and
  // switching it off blurs the page.
  "Emulation.setFocusEmulationEnabled":
    "Every tab in this browser stays live while an agent works in it, so there is nothing to keep live or throttle.",

  // The person uses the same tab, and a frozen page stays frozen for them.
  "Page.setWebLifecycleState":
    "A tab in this browser is shared with the person using the app, so it cannot be frozen.",
};

/** Commands already reported as missing from the table, so each is logged once. */
const reportedUnknown = new Set<string>();

/**
 * Logs, once per command, one that reached a tab and is not in the table of
 * CDP methods: a newer agent-browser, or a caller nobody listed, that nobody
 * has decided how to handle. It still goes on to the debugger.
 */
function noteUnknownMethod(method: string) {
  if (isKnownCdpMethod(method) || reportedUnknown.has(method)) {
    return;
  }
  reportedUnknown.add(method);
  log.warn(`a CDP command the table of CDP methods does not know: ${method}`);
}

/**
 * The command sent to the guest's own debugger, behind the checks every
 * command gets there: input only to a page that renders, keys only to one
 * that holds focus, and a budget on the answer.
 */
async function forwardToDebugger({
  byAgent,
  describeHost,
  entry,
  frameSession,
  method,
  params,
  requestGuestFocus,
  targetId,
}: {
  byAgent: boolean;
  describeHost: (targetId: BrowserTargetId) => Promise<string>;
  entry: BrowserEntry;
  frameSession: string | undefined;
  method: string;
  params: unknown;
  requestGuestFocus: (targetId: BrowserTargetId) => void;
  targetId: BrowserTargetId;
}): Promise<unknown> {
  // agent-browser sends the pointer to the point it is about to press, so the
  // element there is the one the press is for. It is taken before anything
  // else is asked of the page, as near as the host gets to the moment
  // agent-browser checked the point itself.
  if (method === "Input.dispatchMouseEvent" && isMove(params)) {
    await noteElementUnderPointer(entry, params, frameSession);
  }

  // A guest that is not rendering never acknowledges a press, so the command
  // would hang until the timeout below and read as a slow page. When the
  // Studio window is covered or minimized, making it draw gets the guest
  // rendering again (whileEmbedderComposites); refuse, and say why, only when
  // even that does not.
  if (
    method.startsWith("Input.") &&
    !(await guestIsRendering(entry, method)) &&
    !(await guestRendersOnceEmbedderDraws(entry, method))
  ) {
    log.warn(
      `refused ${method} targetId=${targetId}: page is not rendering ${await describeHost(targetId)}`,
    );
    throw new Error(
      "Input was not delivered: this page is not rendering, so it cannot receive clicks, taps, or key presses. The Instrument window is most likely hidden, minimized, or covered by other windows and could not be made to draw. Reading it (snapshot, get text, eval) still works. Ask the user to bring the Instrument window into view, then retry.",
    );
  }

  // One line per press saying what was under the point and whether the user
  // could see the page, so a click that did nothing can be told apart from one
  // that landed somewhere else or on a page nobody was looking at.
  // The press goes where the element was measured. If the page has moved it
  // since, the press would land on whatever took its place and still report
  // success, so the element is measured once more and a press on one that
  // moved is refused. That is the last thing asked of the page before the
  // press, so the page has the least time to move between the two: the
  // agent's pointer, which asks the page to draw the press, is shown first.
  let press: null | { at: number; context: string } = null;
  // Whether the agent's pointer has already been shown this command.
  let pointerShown = false;
  if (method === "Input.dispatchMouseEvent" && isPress(params)) {
    const context = await describePress(
      entry,
      params,
      frameSession,
      describeHost,
    );
    if (byAgent) {
      await showAgentCommand(entry, method, params, frameSession);
      pointerShown = true;
    }
    await refusePressOnMovedElement(entry, params, frameSession);
    press = { at: Date.now(), context };
  }

  // The session the command goes out on: a frame's own when typing is aimed
  // at a field in a frame of its own process.
  let session = frameSession;
  // A frame in a process of its own is a widget of its own, and keyboard input
  // on its session goes to it whether or not the window's focus is there, so
  // only the page's own commands are checked.
  if (
    KEYBOARD_COMMANDS.has(method) &&
    frameSession === undefined &&
    !(await guestHoldsKeyboardFocus(entry))
  ) {
    // Sent to the guest itself, typing leaves the window's focus where it is,
    // so the person keeps typing where they were. What that cannot carry (a
    // chord, IME, a field in a frame of its own) takes focus as below.
    if (byAgent) {
      await showAgentCommand(entry, method, params, frameSession);
      pointerShown = true;
    }
    const typed =
      method === "Input.imeSetComposition"
        ? "no key translation"
        : await typeWithoutFocus(entry, method, params);
    if (typed === true) {
      return {};
    }
    if (typeof typed === "object") {
      session = typed.frameSession;
    } else {
      log.info(`typing ${method} takes focus targetId=${targetId}: ${typed}`);
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
    // 20s is as long as any one answer may take: agent-browser gives up on a
    // command at 30s and then checks the tab for one that stopped responding.
    // A script that awaits longer is kept running and answered across
    // commands (`whyUnanswered`).
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
    if (byAgent && !pointerShown) {
      await showAgentCommand(entry, method, params, frameSession);
    }
    // A script an earlier command left running, when this command asks for
    // its answer: waited on here rather than sent to the page.
    const kept =
      method === "Runtime.evaluate" ? keptScriptOf(params, targetId) : null;
    const startedAt = Date.now();
    const sent =
      kept?.answer ??
      sendToDebugger(
        wc,
        method,
        withMacEditingCommands(method, withoutMacNativeKeyCode(method, params)),
        session,
      );
    let answered = false;
    // Why the wait ran out. A script whose page still answers is awaiting
    // something rather than holding the page, so it is kept for a later
    // command to ask after; anything else is a page that did not answer.
    const whyUnanswered = async (): Promise<Error> => {
      if (
        method === "Runtime.evaluate" &&
        (kept !== null || awaitsPromise(params)) &&
        // A kept script's page may miss one check: the check can land in a
        // task of the page's own that takes longer than the check waits,
        // and nothing was sent to the page for this command to have blocked.
        ((await pageAnswers(wc, session))
          ? noteCheckAnswered(kept)
          : noteCheckMissed(kept)) &&
        !answered
      ) {
        const script =
          kept ?? keepRunningScript({ answer: sent, startedAt, targetId });
        return new ScriptStillRunningError(
          scriptStillRunningMessage({
            id: script.id,
            seconds: Math.round((Date.now() - script.startedAt) / 1000),
          }),
        );
      }
      // Cast is safe: has() is a runtime membership check against a fixed string set
      const isMouse = MOUSE_COMMANDS.has(
        method as "Input.dispatchMouseEvent" | "Input.synthesizeTapGesture",
      );
      const detail = isMouse
        ? `CDP command timed out: ${method}. The page did not acknowledge the input within 5s; it may still be loading or be unresponsive. Take a snapshot to see its current state before retrying.`
        : method === "Page.captureScreenshot"
          ? `CDP command timed out: ${method}. ${SCREENSHOT_NOT_DRAWN}`
          : `CDP command timed out: ${method}. The browser tab is not responding. The page may be unresponsive or still loading. Try navigating directly to a URL or ask the user to reload the app if the problem persists.`;
      return new CdpCommandTimeoutError(method, detail);
    };
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const result = await Promise.race([
      method === "Page.captureScreenshot" || method.startsWith("Input.")
        ? whileEmbedderComposites(wc, sent)
        : sent,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void whyUnanswered().then(reject);
        }, timeoutMs);
      }),
    ]).finally(() => {
      answered = true;
      clearTimeout(timeout);
    });
    if (kept) {
      forgetRunningScript(kept.id);
    }
    if (press) {
      log.info(
        `agent press targetId=${targetId} ${press.context} ack=${Date.now() - press.at}ms`,
      );
    }
    // agent-browser presses the point it read from an element's content
    // quads, after waiting in the page for the element to hold still and
    // checking what that point would hit. The press arrives several commands
    // later, so the measurement is kept for it to be checked against.
    if (method === "DOM.getContentQuads") {
      const quads = quadsOf(result);
      const point = clickPointOf(quads);
      if (point) {
        aimedElement.set(entry, {
          at: Date.now(),
          by: "agent-browser",
          frameSession,
          node: params,
          point,
          quads,
        });
      }
    }
    return result;
  } catch (error) {
    if (press) {
      log.warn(
        `agent press targetId=${targetId} ${press.context} ack=failed after ${Date.now() - press.at}ms`,
      );
    }
    const line = `sendCommand error targetId=${targetId} method=${method} error=${String(error)}`;
    if (error instanceof ScriptStillRunningError) {
      log.info(line);
    } else if (isNavigationRace(error)) {
      log.debug(line);
    } else {
      log.error(line);
    }
    throw error;
  }
}

// Serve a viewport Page.captureScreenshot from webContents.capturePage instead
// of the debugger. capturePage reads the paint-host guest's surface directly.
// Neither path forces a frame on its own when the Studio window is covered or
// minimized: a page navigated to in that state has never drawn, so both wait
// on a frame that never comes, which the forced draw is for. Throws fast on an
// empty frame and at the deadline, so the recorder skips a frame rather than
// the caller hanging.
async function captureViewportScreenshot(
  entry: BrowserEntry,
  p: Protocol.Page.CaptureScreenshotRequest,
): Promise<Protocol.Page.CaptureScreenshotResponse> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    throw new Error("webContents unavailable");
  }
  let image: NativeImage;
  try {
    image = await captureFrame(wc, {
      deadlineMs: 5000,
      forceDraw: true,
      rejectEmpty: true,
    });
  } catch (error) {
    if (error instanceof FrameNotDrawnError) {
      throw new Error(`${error.message}. ${SCREENSHOT_NOT_DRAWN}`, {
        cause: error,
      });
    }
    throw error;
  }
  const data =
    p.format === "jpeg"
      ? image.toJPEG(p.quality ?? 80).toString("base64")
      : image.toPNG().toString("base64");
  return { data };
}

/** Reads and writes the pieces of a capture beyond the viewport with Electron's own image type. */
const nativeImageCodec: ImageCodec = {
  decode: (png) => {
    const image = nativeImage.createFromBuffer(png);
    return { data: image.toBitmap(), ...image.getSize() };
  },
  encode: ({ data, height, width }, format, quality) => {
    const image = nativeImage.createFromBitmap(data, { height, width });
    return format === "jpeg" ? image.toJPEG(quality ?? 80) : image.toPNG();
  },
};

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

/** The `type` of a mouse command, whose params agent-browser sends untyped. */
function mouseEventOf(params: unknown): unknown {
  return typeof params === "object" && params !== null && "type" in params
    ? params.type
    : undefined;
}

/** The point a mouse command names, when its untyped params carry one. */
function pointOf(params: unknown): Point | undefined {
  if (
    typeof params !== "object" ||
    params === null ||
    !("x" in params) ||
    !("y" in params)
  ) {
    return undefined;
  }
  const { x, y } = params;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

function isPress(params: unknown): boolean {
  return mouseEventOf(params) === "mousePressed";
}

function isMove(params: unknown): boolean {
  return mouseEventOf(params) === "mouseMoved";
}

function isQuad(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 8 &&
    value.every((n) => typeof n === "number")
  );
}

function quadArea(quad: number[]): number {
  let sum = 0;
  for (let corner = 0; corner < 4; corner++) {
    const next = (corner + 1) % 4;
    sum +=
      (quad[corner * 2] ?? 0) * (quad[next * 2 + 1] ?? 0) -
      (quad[next * 2] ?? 0) * (quad[corner * 2 + 1] ?? 0);
  }
  return Math.abs(sum / 2);
}

/** The quads of a `DOM.getContentQuads` answer, none when it is not one. */
function quadsOf(result: unknown): number[][] {
  const quads: unknown =
    typeof result === "object" && result !== null && "quads" in result
      ? result.quads
      : undefined;
  return Array.isArray(quads) ? quads.filter(isQuad) : [];
}

/**
 * The point agent-browser presses for an element, from the element's
 * `DOM.getContentQuads`: the center of its largest quad, the last of them
 * when several are as large, rounded by agent-browser to a whole pixel
 * before it presses (`click_point.rs` upstream). An inline element broken
 * across lines has a quad per line, so the point is on one of its pieces.
 */
function clickPointOf(quads: number[][]): null | Point {
  let largest: number[] | undefined;
  for (const quad of quads) {
    if (!largest || quadArea(quad) >= quadArea(largest)) {
      largest = quad;
    }
  }
  if (!largest) {
    return null;
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] =
    largest;
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 };
}

type Point = { x: number; y: number };

function isNear(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= MOVED_PX && Math.abs(a.y - b.y) <= MOVED_PX;
}

function sameQuads(a: number[][], b: number[][]): boolean {
  return (
    a.length === b.length &&
    a.every((quad, index) =>
      quad.every(
        (n, corner) =>
          Math.abs(n - (b[index]?.[corner] ?? Number.NaN)) <= MOVED_PX,
      ),
    )
  );
}

/** Whether the point is on one of the quads: on the same side of all four edges of it, or on an edge. */
function isOnQuads(point: Point, quads: number[][]): boolean {
  return quads.some((quad) => {
    let side = 0;
    for (let corner = 0; corner < 4; corner++) {
      const next = (corner + 1) % 4;
      const ax = quad[corner * 2] ?? 0;
      const ay = quad[corner * 2 + 1] ?? 0;
      const cross =
        ((quad[next * 2] ?? 0) - ax) * (point.y - ay) -
        ((quad[next * 2 + 1] ?? 0) - ay) * (point.x - ax);
      if (cross !== 0 && side !== 0 && Math.sign(cross) !== side) {
        return false;
      }
      side ||= Math.sign(cross);
    }
    return true;
  });
}

/**
 * The element's content quads as they are: `null` when it no longer measures,
 * `undefined` when the guest did not answer in time and so says nothing
 * either way.
 */
function measureElement(
  wc: WebContents,
  node: unknown,
  frameSession: string | undefined,
): Promise<null | number[][] | undefined> {
  return withinGuestProbeTimeout<null | number[][] | undefined>(
    sendToDebugger(wc, "DOM.getContentQuads", node, frameSession).then(
      (result) => {
        const quads = quadsOf(result);
        return quads.length > 0 ? quads : null;
      },
      () => null,
    ),
    () => undefined,
  );
}

/**
 * Keeps the element under the point the pointer is being sent to, and where
 * it is, unless agent-browser measured an element for that point itself. A
 * click by selector or by `find` measures in a script of agent-browser's own
 * and names no element to the debugger, so the first the host knows of the
 * click is the pointer arriving at its point. An element an earlier arrival
 * found there is not kept for this one: the page may have put another in its
 * place since.
 */
async function noteElementUnderPointer(
  entry: BrowserEntry,
  params: unknown,
  frameSession: string | undefined,
): Promise<void> {
  const wc = entry.webContents;
  const point = pointOf(params);
  if (!wc || !point) {
    return;
  }
  const { x, y } = point;
  const known = aimedElement.get(entry);
  if (
    known &&
    known.by === "agent-browser" &&
    known.frameSession === frameSession &&
    Date.now() - known.at <= MEASUREMENT_FRESH_MS &&
    isNear(point, known.point)
  ) {
    return;
  }
  aimedElement.delete(entry);
  void sendToDebugger(
    wc,
    "Runtime.releaseObjectGroup",
    { objectGroup: AIMED_OBJECT_GROUP },
    frameSession,
  ).catch(noop);
  const element = await withinGuestProbeTimeout(
    sendToDebugger(
      wc,
      "Runtime.evaluate",
      {
        expression: `document.elementFromPoint(${x}, ${y})`,
        objectGroup: AIMED_OBJECT_GROUP,
        silent: true,
      },
      frameSession,
    ).then(
      // Cast: an answer from the debugger is untyped, and only an object's handle is read from it.
      (answer) =>
        (answer as null | { result?: { objectId?: unknown } })?.result
          ?.objectId,
      () => undefined,
    ),
    () => undefined,
  );
  if (typeof element !== "string") {
    return;
  }
  const node = { objectId: element };
  const quads = await measureElement(wc, node, frameSession);
  if (quads) {
    aimedElement.set(entry, {
      at: Date.now(),
      by: "pointer",
      frameSession,
      node,
      point,
      quads,
    });
  }
}

/**
 * Refuses a press aimed at an element that has moved out from under it, or
 * gone, since it was measured. agent-browser waits for the element to hold
 * still and checks what its point would hit before it sends anything, but the
 * press follows that check by several commands and a rendered frame, and a
 * page that moves in between (an image arriving, a banner sliding in) would
 * take the press on whatever is at the point by then. An element that changed
 * around the point, as one whose hover style grows or lifts it does, is still
 * what the press lands on, and the press goes. A second press of the same
 * click, as a double click sends, finds no measurement and goes as it came.
 *
 * What is held to the element is the point the press names, which
 * agent-browser rounds to a whole pixel, rather than the point measured.
 */
async function refusePressOnMovedElement(
  entry: BrowserEntry,
  params: unknown,
  frameSession: string | undefined,
): Promise<void> {
  const wc = entry.webContents;
  const aimed = aimedElement.get(entry);
  aimedElement.delete(entry);
  // A measurement and a press are in the coordinates of the page or frame
  // they were sent to, so only a press to the same one is checked against it.
  if (
    !wc ||
    !aimed ||
    aimed.frameSession !== frameSession ||
    Date.now() - aimed.at > MEASUREMENT_FRESH_MS
  ) {
    return;
  }
  const pressed = pointOf(params);
  // Only a press aimed at the measured point is a click on that element.
  if (!pressed || !isNear(pressed, aimed.point)) {
    return;
  }
  const now = await measureElement(wc, aimed.node, frameSession);
  if (
    now === undefined ||
    (now &&
      // A press on the element's content has to stay on it. One on its
      // padding or border is on none of its content quads, before or after,
      // so it is held to the element being where it was.
      (isOnQuads(pressed, aimed.quads)
        ? isOnQuads(pressed, now)
        : sameQuads(aimed.quads, now)))
  ) {
    return;
  }
  log.warn(
    `refused press targetId=${entry.targetId}: the element pressed at ${pressed.x},${pressed.y} ${now ? "moved" : "is gone"}`,
  );
  throw new Error(
    now
      ? "The click was not sent: the element moved after it was measured, so the press could have landed on whatever moved into its place. Click it again."
      : "The click was not sent: the element changed after it was measured and can no longer be found on the page. Take a snapshot to see the page as it is now, then click the element by its new ref.",
  );
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
  frameSession: string | undefined,
  describeHost: (targetId: BrowserTargetId) => Promise<string>,
): Promise<string> {
  const point = pointOf(params);
  if (!point) {
    return "at=unknown";
  }
  const { x, y } = point;
  const wc = entry.webContents;
  // A press to a frame is in the frame's coordinates, which the page's own
  // hit test cannot place.
  const hit: Promise<unknown> = frameSession
    ? Promise.resolve("hit=in-frame")
    : wc
      ? withinGuestProbeTimeout(
          wc.executeJavaScript(describeHitScript(x, y)),
          () => "hit=unknown",
        )
      : Promise.resolve(undefined);
  const [what, host] = await Promise.all([
    hit.then(String, () => "hit=unknown"),
    describeHost(entry.targetId).catch(() => "host=unknown"),
  ]);
  return [`at=${x},${y}`, what, host].filter(Boolean).join(" ");
}

/**
 * The running script a command asks for the answer of, or null when the
 * command is a script of its own. Refuses one that is no longer kept, or that
 * another tab runs, since the expression that asks is not a script a page
 * could run.
 */
function keptScriptOf(
  params: unknown,
  targetId: BrowserTargetId,
): null | RunningScript {
  const id = runningScriptAskedFor(
    (params as undefined | { expression?: unknown })?.expression,
  );
  if (id === undefined) {
    return null;
  }
  const script = runningScript(id, targetId);
  if (!script) {
    throw new Error(
      "That script's answer is no longer kept: it finished more than a minute ago, other scripts were left running after it, or it runs in another tab.",
    );
  }
  return script;
}

/** How many checks in a row a kept script's page may leave unanswered. */
const MISSED_CHECKS_ALLOWED = 1;

/** Whether the script is still taken as awaiting after a check its page answered. */
function noteCheckAnswered(kept: null | RunningScript): boolean {
  if (kept) {
    kept.missedChecks = 0;
  }
  return true;
}

/**
 * Whether the script is still taken as awaiting after a check its page did
 * not answer, which a script only now sent never is.
 */
function noteCheckMissed(kept: null | RunningScript): boolean {
  if (!kept) {
    return false;
  }
  kept.missedChecks += 1;
  return kept.missedChecks <= MISSED_CHECKS_ALLOWED;
}

function awaitsPromise(params: unknown): boolean {
  return (
    (params as undefined | { awaitPromise?: unknown })?.awaitPromise === true
  );
}

/**
 * Whether the page runs a script when asked, which one with a blocked main
 * thread does not. A script that is only awaiting leaves the page free to
 * answer this while its own answer is still pending.
 */
function pageAnswers(
  wc: WebContents,
  frameSession: string | undefined,
): Promise<boolean> {
  return withinGuestProbeTimeout(
    sendToDebugger(
      wc,
      "Runtime.evaluate",
      { expression: "1", returnByValue: true },
      frameSession,
    ).then(
      () => true,
      () => false,
    ),
    () => false,
  );
}

/** A command to the guest's debugger: to the page, or to a frame by its session. */
function sendToDebugger(
  wc: WebContents,
  method: string,
  params: unknown,
  frameSession: string | undefined,
): Promise<unknown> {
  return frameSession === undefined
    ? wc.debugger.sendCommand(method, params)
    : wc.debugger.sendCommand(method, params, frameSession);
}

// Whether the guest is producing frames, which is what input acknowledgement
// waits on. Its visibilityState is no guide: background throttling is off for
// guests, so a guest in a covered window reports "visible" while rendering
// nothing. A page that renders answers one animation frame well inside the
// probe's window. A page busy past that window holds its timer as well as its
// frame, so a timer that fires late says busy rather than not drawing, and
// counts as drawing. Fails open when the probe itself errors, and a passing
// answer is reused briefly so the move, press, and release of one click pay
// for it once.
const RENDERING_PROBE_SCRIPT =
  "new Promise((resolve) => { const asked = performance.now(); requestAnimationFrame(() => resolve(true)); setTimeout(() => resolve(performance.now() - asked > 200), 150); })";
const RENDERING_REUSE_MS = 1000;
const renderingSeenAt = new WeakMap<BrowserEntry, number>();

// Whether the guest currently holds Chromium's keyboard focus, which is the
// precondition for CDP keyboard input reaching it at all. Asked of the
// window's own renderer: keyboard input follows the window's focus tree to the
// guest exactly when the window's focused element is this guest's `<webview>`,
// whether or not the window itself is in front. The guest
// cannot answer this itself, since an agent-driven guest runs under focus
// emulation (`document.hasFocus()` is always true there) and a page can
// redefine `document.hasFocus`; a wrong yes sends the agent's keys to
// whatever holds the window's focus. `webContents` focus state is unreliable
// for `<webview>` guests. Fails closed on every error path.
async function guestHoldsKeyboardFocus(entry: BrowserEntry): Promise<boolean> {
  const wc = entry.webContents;
  const host = wc?.hostWebContents;
  if (!wc || wc.isDestroyed() || !host || host.isDestroyed()) {
    return false;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const hasFocus: unknown = await Promise.race([
      host.executeJavaScript(holdsKeyboardScript(wc.id)),
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

const holdsKeyboardScript = (guestId: number) => `(() => {
  const focused = document.activeElement;
  try {
    return focused?.tagName === "WEBVIEW" && focused.getWebContentsId() === ${guestId};
  } catch {
    return false;
  }
})()`;

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

// Asks again while the Studio window is made to draw, which is what a guest in
// a covered or minimized window needs to produce a frame.
async function guestRendersOnceEmbedderDraws(
  entry: BrowserEntry,
  method: string,
): Promise<boolean> {
  const wc = entry.webContents;
  if (!wc || wc.isDestroyed()) {
    return false;
  }
  return await whileEmbedderComposites(wc, guestIsRendering(entry, method));
}

// Ask the renderer to focus the guest, then wait for the guest to agree that
// it holds focus. Returns false when the guest never took focus, which keeps
// the caller failing closed.
async function repairGuestKeyboardFocus(
  entry: BrowserEntry,
  requestGuestFocus: (targetId: BrowserTargetId) => void,
): Promise<boolean> {
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
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, GUEST_PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
