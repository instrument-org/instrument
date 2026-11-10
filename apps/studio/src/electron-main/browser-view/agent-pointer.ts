import type { WebContents } from "electron";

import { noop } from "radashi";

import type { BrowserEntry } from "./entry";

/**
 * The agent's pointer: an arrow drawn in the page at each point an agent's
 * mouse command lands, so the person watching the tab sees where it moves and
 * clicks. It is drawn the way a browser extension's content script draws over
 * a page: from a world of its own, so the page's scripts cannot reach its
 * state, into a closed shadow root the page's styles cannot reach, hidden from
 * assistive technology and from hit testing, and put in the top layer so a
 * page's dialog or full-screen element does not cover it. Being part of the
 * page, it is in every picture taken of the page except the agent's own
 * screenshots, which hide it while they are taken.
 */

/** The isolated world the pointer runs in, one no other script of the app uses. */
const POINTER_WORLD = 1077;

/** How long the pointer stays after the agent's last mouse command before it fades. */
const POINTER_IDLE_MS = 5000;

/** How long the page is given to apply a change before it is given up on: a page held by a dialog or a busy script answers late or never. */
const PAGE_TIMEOUT_MS = 1000;

type PointerUpdate = {
  down: boolean;
  /** How long the pointer stays before it fades. */
  idleMs: number;
  press: boolean;
  x: number;
  y: number;
};

type PointerState = {
  /** Whether the agent's last press has not been released yet. */
  down: boolean;
  /** Where and when the agent last moved, pressed or released, for whether the pointer is still showing. */
  last: { at: number; x: number; y: number } | undefined;
  /** The newest update not yet sent; a newer one replaces it, keeping a press it carried. */
  pending: PointerUpdate | undefined;
  /** Whether an update is on its way to the page, so the next waits rather than racing it. */
  sending: boolean;
};

const pointers = new WeakMap<BrowserEntry, PointerState>();

/**
 * Moves the pointer to where an agent's mouse command was delivered. Only a
 * command to the page itself moves it: one to a frame in a process of its own
 * is in the frame's coordinates. Never waits on the page and never throws, so
 * it cannot hold up or fail the command it follows.
 */
export function showAgentPointer(
  entry: BrowserEntry,
  method: string,
  params: unknown,
  frameSession: string | undefined,
): void {
  if (method !== "Input.dispatchMouseEvent" || frameSession !== undefined) {
    return;
  }
  const { type, x, y } = (params ?? {}) as {
    type?: string;
    x?: unknown;
    y?: unknown;
  };
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    (type !== "mouseMoved" &&
      type !== "mousePressed" &&
      type !== "mouseReleased")
  ) {
    return;
  }
  const state = pointers.get(entry) ?? {
    down: false,
    last: undefined,
    pending: undefined,
    sending: false,
  };
  pointers.set(entry, state);
  if (type === "mousePressed") {
    state.down = true;
  } else if (type === "mouseReleased") {
    state.down = false;
  }
  state.last = { at: Date.now(), x, y };
  state.pending = {
    down: state.down,
    idleMs: POINTER_IDLE_MS,
    press: type === "mousePressed" || (state.pending?.press ?? false),
    x,
    y,
  };
  void sendPending(entry, state);
}

/**
 * Puts the pointer back where it was on a document the page just loaded, for
 * the rest of the time it had left: a click that follows a link takes the old
 * document, and the pointer drawn in it, with it the moment the new one
 * commits, so without this the person would see the pointer go to the link
 * and vanish.
 */
export function carryAgentPointer(entry: BrowserEntry): void {
  const state = pointers.get(entry);
  const left = state?.last ? POINTER_IDLE_MS - (Date.now() - state.last.at) : 0;
  if (!state?.last || left <= 0) {
    return;
  }
  state.pending = {
    down: false,
    idleMs: left,
    press: false,
    x: state.last.x,
    y: state.last.y,
  };
  void sendPending(entry, state);
}

/** Sends updates one at a time, the newest each time, so a drag's moves never queue up behind a slow page. */
async function sendPending(entry: BrowserEntry, state: PointerState) {
  if (state.sending) {
    return;
  }
  state.sending = true;
  try {
    while (state.pending) {
      const update = state.pending;
      state.pending = undefined;
      const wc = entry.webContents;
      if (!wc || wc.isDestroyed()) {
        return;
      }
      await runInPage(wc, `(${POINTER_SCRIPT})(${JSON.stringify(update)})`);
    }
  } finally {
    state.sending = false;
  }
}

/**
 * Runs `take` with the pointer hidden, for a screenshot the agent asked for:
 * the pointer is there for the person, and in the agent's own picture of the
 * page it would only cover what it is looking at. A pointer that has faded is
 * left alone.
 */
export async function withoutAgentPointer<T>(
  entry: BrowserEntry,
  take: () => Promise<T>,
): Promise<T> {
  const state = pointers.get(entry);
  const wc = entry.webContents;
  if (
    !state ||
    !wc ||
    wc.isDestroyed() ||
    !state.last ||
    Date.now() - state.last.at > POINTER_IDLE_MS + FADE_MS
  ) {
    return await take();
  }
  await runInPage(wc, HIDE_FOR_CAPTURE_SCRIPT);
  try {
    return await take();
  } finally {
    void runInPage(wc, SHOW_AFTER_CAPTURE_SCRIPT);
  }
}

async function runInPage(wc: WebContents, code: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    // Called inside the chain so a contents torn down meanwhile rejects
    // rather than throws.
    Promise.resolve()
      .then(() =>
        wc.executeJavaScriptInIsolatedWorld(POINTER_WORLD, [{ code }]),
      )
      .catch(noop),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PAGE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/** How long the pointer takes to fade once idle. */
const FADE_MS = 600;
/** How long the arrow takes to glide to a new point: long enough to see it travel, short enough to arrive with the click. */
const GLIDE_MS = 160;
/** The brand teal of the app, so the pointer reads as the app's agent rather than the page's own cursor. */
const POINTER_COLOR = "#0e7869";

// Runs in the page's document, in the pointer's own world, so its state lives
// on that world's global and a page that navigates starts over with none.
// Everything is styled through the CSSOM rather than a <style> element or
// markup, which a page's Content-Security-Policy or Trusted Types could
// refuse, and with !important on the host, which the page's own rules can
// reach.
const POINTER_SCRIPT = String.raw`function (update) {
  const FADE_MS = ${FADE_MS};
  const GLIDE_MS = ${GLIDE_MS};
  const COLOR = "${POINTER_COLOR}";
  const SVG = "http://www.w3.org/2000/svg";
  const GLIDE = "transform " + GLIDE_MS + "ms cubic-bezier(0.2, 0, 0, 1)";
  const SHOWING = GLIDE + ", opacity 120ms ease";
  const FADING = GLIDE + ", opacity " + FADE_MS + "ms ease";
  const set = (element, styles, priority) => {
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value, priority);
    }
  };
  let state = globalThis.__instrumentAgentPointer;
  if (!state || !state.host.isConnected) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("popover", "manual");
    set(host, {
      position: "fixed",
      inset: "0 auto auto 0",
      width: "0",
      height: "0",
      margin: "0",
      padding: "0",
      border: "0",
      overflow: "visible",
      background: "transparent",
      "pointer-events": "none",
      "z-index": "2147483647",
      display: "block",
    }, "important");
    const root = host.attachShadow({ mode: "closed" });
    const ring = document.createElement("div");
    set(ring, {
      position: "absolute",
      left: "-14px",
      top: "-14px",
      width: "28px",
      height: "28px",
      "border-radius": "50%",
      border: "2px solid " + COLOR,
      "box-sizing": "border-box",
      opacity: "0",
    });
    const pointer = document.createElement("div");
    set(pointer, {
      position: "absolute",
      left: "0",
      top: "0",
      opacity: "0",
      transition: SHOWING,
      "will-change": "transform",
    });
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "26");
    svg.setAttribute("viewBox", "0 0 22 26");
    set(svg, {
      display: "block",
      overflow: "visible",
      transform: "translate(-3px, -2px)",
      "transform-origin": "3px 2px",
      transition: "transform 90ms ease",
      filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))",
    });
    const arrow = document.createElementNS(SVG, "path");
    arrow.setAttribute("d", "M3 2 L3 20 L7.6 15.6 L10.6 22.6 L13.8 21.2 L10.8 14.4 L17 14.4 Z");
    arrow.setAttribute("fill", COLOR);
    arrow.setAttribute("stroke", "white");
    arrow.setAttribute("stroke-width", "1.6");
    arrow.setAttribute("stroke-linejoin", "round");
    svg.append(arrow);
    pointer.append(svg);
    root.append(ring, pointer);
    document.documentElement.append(host);
    state = globalThis.__instrumentAgentPointer = {
      host,
      pointer,
      ring,
      svg,
      fade: 0,
      at: null,
      down: false,
      movedAt: 0,
    };
  }
  const { host, pointer, ring, svg } = state;
  const raise = () => {
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {}
  };
  const moved = !state.at || state.at.x !== update.x || state.at.y !== update.y;
  if (!state.at) {
    // A new pointer appears where it is rather than gliding in from a corner.
    pointer.style.transition = "none";
    pointer.style.transform = "translate(" + update.x + "px, " + update.y + "px)";
    pointer.getBoundingClientRect();
    pointer.style.transition = SHOWING;
    raise();
  } else if (moved) {
    pointer.style.transform = "translate(" + update.x + "px, " + update.y + "px)";
  }
  if (moved) {
    state.movedAt = performance.now();
  }
  state.at = { x: update.x, y: update.y };
  pointer.style.transition = SHOWING;
  pointer.style.opacity = "1";
  svg.style.transform = update.down ? "translate(-3px, -2px) scale(0.86)" : "translate(-3px, -2px)";
  // Above whatever the page put in the top layer since: a dialog the press
  // opens, or the one the click that follows its release opens.
  if (update.press || (state.down && !update.down)) {
    raise();
  }
  state.down = update.down;
  if (update.press) {
    ring.style.left = (update.x - 14) + "px";
    ring.style.top = (update.y - 14) + "px";
    const glideLeft = Math.max(0, GLIDE_MS - (performance.now() - state.movedAt));
    ring.animate(
      [
        { opacity: 0.9, transform: "scale(0.3)" },
        { opacity: 0, transform: "scale(1.5)" },
      ],
      { delay: glideLeft, duration: 450, easing: "ease-out" },
    );
  }
  clearTimeout(state.fade);
  state.fade = setTimeout(() => {
    pointer.style.transition = FADING;
    pointer.style.opacity = "0";
  }, update.idleMs);
}`;

// Hides the pointer at once and answers once the page has drawn a frame
// without it, so the screenshot that follows does not catch it on its way out.
const HIDE_FOR_CAPTURE_SCRIPT = `(() => {
  const state = globalThis.__instrumentAgentPointer;
  if (!state || !state.host.isConnected) return;
  state.host.style.setProperty("visibility", "hidden", "important");
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
    setTimeout(resolve, 100);
  });
})()`;

const SHOW_AFTER_CAPTURE_SCRIPT = `(() => {
  const state = globalThis.__instrumentAgentPointer;
  if (state) state.host.style.setProperty("visibility", "visible", "important");
})()`;
