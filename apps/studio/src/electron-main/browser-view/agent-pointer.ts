import type { WebContents } from "electron";

import {
  isDrivenByWorkingAgent,
  isPageWork,
} from "@instrument-org/workspace/electron";
import { noop } from "radashi";

import type { BrowserEntry } from "./entry";

/**
 * The agent's pointer: a dart drawn in the page where an agent works, so the
 * person watching the tab sees where it moves, clicks, types and scrolls. It
 * comes in when an agent starts working in the page, stays at the last place
 * it acted for as long as an agent with a turn running has driven the tab,
 * drifting a little while the agent thinks, and goes once none has.
 *
 * It is drawn the way a browser extension's content script draws over a page:
 * from a world of its own, so the page's scripts cannot reach its state, into
 * a closed shadow root the page's styles cannot reach, hidden from assistive
 * technology and from hit testing, and put in the top layer so a page's dialog
 * or full-screen element does not cover it. Being part of the page, it is in
 * every picture taken of the page except the agent's own screenshots, which
 * hide it while they are taken.
 */

/** The isolated world the pointer runs in, one no other script of the app uses. */
const POINTER_WORLD = 1077;

/** How long the page is given to apply a change before it is given up on: a page held by a dialog or a busy script answers late or never. */
const PAGE_TIMEOUT_MS = 1000;

/**
 * The longest an agent's mouse move waits for the pointer to arrive before it
 * is sent, so the page sees the move, and the press after it, as the pointer
 * lands. Longer than the longest glide.
 */
const GLIDE_WAIT_MS = 450;

/** How often a showing pointer asks whether an agent at work still drives the tab. */
const PRESENCE_CHECK_MS = 1000;

type Point = { x: number; y: number };

/** What the page is told to show. */
type Act =
  | ({ kind: "move" | "press" | "release" } & Point)
  | ({ kind: "restore" } & Point)
  | ({ kind: "scroll"; dy: number } & Partial<Point>)
  | { kind: "here" | "hide" | "leave" | "type" | "unhide" };

type Queued = { act: Act; done: () => void };

type PointerState = {
  /** Where the agent last moved, pressed, released or scrolled, for a document the tab loads next. */
  at: Point | undefined;
  /** Whether the pointer is showing: from an agent's first command in the tab until no agent at work drives it. */
  present: boolean;
  /** What is still to go to the page, oldest first; a move replaces a move waiting before it. */
  queue: Queued[];
  /** Whether an act is on its way to the page, so the next waits rather than racing it. */
  sending: boolean;
  watch: ReturnType<typeof setInterval> | undefined;
};

const pointers = new WeakMap<BrowserEntry, PointerState>();

function stateOf(entry: BrowserEntry): PointerState {
  let state = pointers.get(entry);
  if (!state) {
    state = {
      at: undefined,
      present: false,
      queue: [],
      sending: false,
      watch: undefined,
    };
    pointers.set(entry, state);
  }
  return state;
}

/**
 * Shows an agent's command to a tab's page before it is sent. A mouse move
 * resolves once the pointer has glided to its point, or after
 * `GLIDE_WAIT_MS`, so the move and the press after it reach the page as the
 * pointer lands; everything else resolves at once. Only the page's own
 * commands place it: one to a frame in a process of its own is in the
 * frame's coordinates, and only says the agent is at work. Never throws, so
 * it cannot fail the command it shows.
 */
export function showAgentCommand(
  entry: BrowserEntry,
  method: string,
  params: unknown,
  frameSession: string | undefined,
): Promise<void> {
  const act = actOf(method, params, frameSession);
  if (!act) {
    return Promise.resolve();
  }
  const state = stateOf(entry);
  if ("x" in act && act.x !== undefined && act.y !== undefined) {
    state.at = { x: act.x, y: act.y };
  }
  if (act.kind === "here" && state.present) {
    return Promise.resolve();
  }
  arrive(entry, state);
  return send(entry, state, act);
}

function actOf(
  method: string,
  params: unknown,
  frameSession: string | undefined,
): Act | undefined {
  // agent-browser's bookkeeping (attaching, switching domains on, checking
  // that a page answers) reaches every tab it can see, so only work in a page
  // says the agent is in it.
  if (!isPageWork(method, params)) {
    return undefined;
  }
  if (frameSession !== undefined) {
    return { kind: "here" };
  }
  const p = (params ?? {}) as {
    deltaY?: unknown;
    type?: unknown;
    x?: unknown;
    y?: unknown;
  };
  if (method === "Input.dispatchMouseEvent") {
    const { type, x, y } = p;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return { kind: "here" };
    }
    switch (type) {
      case "mouseMoved":
        return { kind: "move", x, y };
      case "mousePressed":
        return { kind: "press", x, y };
      case "mouseReleased":
        return { kind: "release", x, y };
      case "mouseWheel": {
        const dy = typeof p.deltaY === "number" ? p.deltaY : 0;
        // agent-browser sends a wheel where its own mouse last was, and
        // that starts at the page's corner until it first moves the mouse:
        // a wheel there has no point of its own and scrolls where the
        // pointer is.
        return x === 0 && y === 0
          ? { dy, kind: "scroll" }
          : { dy, kind: "scroll", x, y };
      }
      default:
        return { kind: "here" };
    }
  }
  if (
    method === "Input.insertText" ||
    (method === "Input.dispatchKeyEvent" &&
      (p.type === "keyDown" || p.type === "rawKeyDown"))
  ) {
    return { kind: "type" };
  }
  return { kind: "here" };
}

/** Marks the pointer showing and starts asking whether an agent at work still drives the tab. */
function arrive(entry: BrowserEntry, state: PointerState) {
  if (state.present) {
    return;
  }
  state.present = true;
  clearInterval(state.watch);
  state.watch = setInterval(() => {
    void stillDriven(entry, state);
  }, PRESENCE_CHECK_MS);
}

async function stillDriven(entry: BrowserEntry, state: PointerState) {
  const wc = entry.webContents;
  const driven =
    !!wc &&
    !wc.isDestroyed() &&
    // A tab whose drivers cannot be read keeps its pointer until they can.
    (await isDrivenByWorkingAgent(entry.targetId).catch(() => true));
  if (driven || !state.present) {
    return;
  }
  state.present = false;
  clearInterval(state.watch);
  state.watch = undefined;
  if (wc && !wc.isDestroyed()) {
    void send(entry, state, { kind: "leave" });
  }
}

/**
 * Puts the pointer back on a document the page just loaded, where it last
 * was: a click that follows a link takes the old document, and the pointer
 * drawn in it, with it the moment the new one commits.
 */
export function carryAgentPointer(entry: BrowserEntry): void {
  const state = pointers.get(entry);
  if (!state?.present) {
    return;
  }
  void send(
    entry,
    state,
    state.at ? { kind: "restore", ...state.at } : { kind: "here" },
  );
}

/**
 * Runs `take` with the pointer hidden, for a screenshot the agent asked for:
 * the pointer is there for the person, and in the agent's own picture of the
 * page it would only cover what it is looking at.
 */
export async function withoutAgentPointer<T>(
  entry: BrowserEntry,
  take: () => Promise<T>,
): Promise<T> {
  const state = pointers.get(entry);
  if (!state?.present) {
    return await take();
  }
  await send(entry, state, { kind: "hide" });
  try {
    return await take();
  } finally {
    void send(entry, state, { kind: "unhide" });
  }
}

/** Queues an act for the page; resolves once the page has done it, or given up on. */
function send(
  entry: BrowserEntry,
  state: PointerState,
  act: Act,
): Promise<void> {
  return new Promise((done) => {
    const last = state.queue.at(-1);
    if (act.kind === "move" && last?.act.kind === "move") {
      // A drag's moves never queue up behind a slow page: the newest is the
      // one worth drawing, and the move it replaces is sent on at once.
      state.queue.pop();
      last.done();
    }
    state.queue.push({ act, done });
    void drain(entry, state);
  });
}

async function drain(entry: BrowserEntry, state: PointerState) {
  if (state.sending) {
    return;
  }
  state.sending = true;
  try {
    for (;;) {
      const next = state.queue.shift();
      if (!next) {
        return;
      }
      const wc = entry.webContents;
      if (wc && !wc.isDestroyed()) {
        await applyInPage(wc, next.act);
      }
      next.done();
    }
  } finally {
    state.sending = false;
  }
}

/** Applies an act in the page, installing the pointer first in a document that has none. */
async function applyInPage(wc: WebContents, act: Act): Promise<void> {
  const payload = JSON.stringify(act);
  const timeoutMs = act.kind === "move" ? GLIDE_WAIT_MS : PAGE_TIMEOUT_MS;
  const answer = await runInPage(
    wc,
    `globalThis.__instrumentAgentPointer ? globalThis.__instrumentAgentPointer.apply(${payload}) : "${MISSING}"`,
    timeoutMs,
  );
  // A document with no pointer has nothing to take away or hide.
  if (
    answer === MISSING &&
    act.kind !== "leave" &&
    act.kind !== "hide" &&
    act.kind !== "unhide"
  ) {
    await runInPage(
      wc,
      `(${POINTER_SOURCE})(${JSON.stringify(POINTER_CONFIG)}).apply(${payload})`,
      timeoutMs,
    );
  }
}

const MISSING = "__missing__";

async function runInPage(
  wc: WebContents,
  code: string,
  timeoutMs: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    // Called inside the chain so a contents torn down meanwhile rejects
    // rather than throws.
    Promise.resolve()
      .then(
        // Cast: Electron types the script's answer as `any`.
        () =>
          wc.executeJavaScriptInIsolatedWorld(POINTER_WORLD, [
            { code },
          ]) as Promise<unknown>,
      )
      .catch(noop),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

const POINTER_CONFIG = {
  /** The brand teal of the app, so the pointer reads as the app's agent rather than the page's own cursor. */
  color: "#0e7869",
  /** What the tag beside the dart says between acts, while the agent works out its next step. */
  resting: "Thinking",
};

// Runs in the page's document, in the pointer's own world, once per document:
// it builds the pointer and returns what main drives it through, kept on that
// world's global. Everything is styled through the CSSOM rather than a
// <style> element or markup, which a page's Content-Security-Policy or Trusted
// Types could refuse, and with !important on the host, which the page's own
// rules can reach. The tag's words are drawn by a constructed stylesheet's
// `content`, so the page's find-in-page and `window.find` never match them.
const POINTER_SOURCE = String.raw`function (config) {
  const COLOR = config.color;
  const SVG = "http://www.w3.org/2000/svg";
  // Where the dart's tip is in its box; the tag sits in its notch.
  const TIP = 2.78;
  const TAG_X = 16.9;
  const TAG_Y = 12.4;
  // How long a verb stays on the tag after the act it names.
  const VERB_MS = 1400;
  // How long the pointer waits after the agent's last act before it idles.
  const IDLE_AFTER_MS = 1800;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (e0, e1, v) => {
    const t = clamp((v - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const set = (element, styles, priority) => {
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value, priority);
    }
  };

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
    visibility: "visible",
  }, "important");
  const root = host.attachShadow({ mode: "closed" });
  let say = (element, words) => {
    element.textContent = words;
  };
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".words::after { content: attr(data-words); }");
    root.adoptedStyleSheets = [sheet];
    say = (element, words) => {
      element.setAttribute("data-words", words);
    };
  } catch {}

  const ring = document.createElement("div");
  set(ring, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "30px",
    height: "30px",
    margin: "-15px 0 0 -15px",
    "border-radius": "50%",
    border: "2px solid " + COLOR,
    "box-sizing": "border-box",
    opacity: "0",
  });
  // The body sits on the point and fades; the pose turns and scales the dart
  // about its tip; the breath swells it while the agent thinks.
  const body = document.createElement("div");
  set(body, {
    position: "absolute",
    left: "0",
    top: "0",
    opacity: "0",
    "will-change": "transform, opacity",
  });
  const pose = document.createElement("div");
  set(pose, { position: "absolute", left: "0", top: "0", "transform-origin": "0 0" });
  const breath = document.createElement("div");
  set(breath, { "transform-origin": "0 0" });
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 26 26");
  set(svg, {
    display: "block",
    overflow: "visible",
    transform: "translate(-" + TIP + "px, -" + TIP + "px)",
    filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.3))",
  });
  const dart = document.createElementNS(SVG, "path");
  dart.setAttribute("d", "M2.08 5.88A2.97 2.97 0 0 1 5.88 2.08L21.25 7.53A2.86 2.86 0 0 1 21.01 13L15.08 14.52A0.77 0.77 0 0 0 14.52 15.08L13 21.01A2.86 2.86 0 0 1 7.53 21.25Z");
  dart.setAttribute("fill", COLOR);
  dart.setAttribute("stroke", "white");
  dart.setAttribute("stroke-width", "1.5");
  dart.setAttribute("stroke-linejoin", "round");
  svg.append(dart);
  breath.append(svg);
  pose.append(breath);
  // Every inherited property is set, since the shadow tree inherits the
  // page's text styles through the host.
  const tag = document.createElement("div");
  tag.className = "words";
  set(tag, {
    position: "absolute",
    left: TAG_X + "px",
    top: TAG_Y + "px",
    width: "max-content",
    padding: "1px 7px",
    "border-radius": "99px",
    "background-color": COLOR,
    color: "white",
    font: "500 11px/16px Inter, system-ui, sans-serif",
    "font-feature-settings": "normal",
    "letter-spacing": "normal",
    "word-spacing": "normal",
    "text-transform": "none",
    "text-shadow": "none",
    "text-align": "left",
    "text-indent": "0",
    "white-space": "nowrap",
    direction: "ltr",
    "writing-mode": "horizontal-tb",
    "user-select": "none",
    "box-shadow": "0 0 0 1px white, 0 1px 3px rgb(0 0 0 / 0.25)",
    transition: "opacity 120ms ease",
  });
  body.append(pose, tag);
  root.append(ring, body);
  document.documentElement.append(host);

  const s = {
    shown: false,
    leaving: false,
    x: 0,
    y: 0,
    prevX: 0,
    // The point the agent last acted at, which the idle drift circles.
    anchor: null,
    flight: null,
    side: 1,
    lean: 0,
    scale: 1,
    scaleV: 0,
    pressed: false,
    nudge: 0,
    nudgeV: 0,
    raf: 0,
    last: 0,
    idle: 0,
    breathing: null,
    words: "",
    verb: 0,
    tagW: 0,
    tagH: 0,
    flip: "",
  };

  const raise = () => {
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {}
  };

  const label = (words) => {
    if (s.words === words) return;
    s.words = words;
    say(tag, words);
    s.tagW = tag.offsetWidth;
    s.tagH = tag.offsetHeight;
    s.flip = "";
  };
  const verb = (words) => {
    label(words);
    clearTimeout(s.verb);
    s.verb = setTimeout(() => label(config.resting), VERB_MS);
  };
  label(config.resting);

  // Near the page's right or bottom edge the tag goes to the other side of
  // the tip, where it is not cut off.
  const placeTag = () => {
    const view = document.documentElement;
    const right = s.x + TAG_X + s.tagW + 2 > (view.clientWidth || innerWidth);
    const below = s.y + TAG_Y + s.tagH + 2 > (view.clientHeight || innerHeight);
    const flip = (right ? "r" : "") + (below ? "b" : "");
    if (flip === s.flip) return;
    s.flip = flip;
    tag.style.left = (right ? -s.tagW - 4 : TAG_X) + "px";
    tag.style.top = (below ? -s.tagH - 4 : TAG_Y) + "px";
  };

  const frame = (now) => {
    s.raf = 0;
    const dt = s.last ? Math.min(50, now - s.last) : 16;
    s.last = now;
    const f = s.flight;
    if (f) {
      const u = clamp((now - f.start) / f.dur, 0, 1);
      const m = smoother(Math.min(1, u / f.mainEnds));
      const a = 1 - m;
      let x = a * a * a * f.x0 + 3 * a * a * m * f.c1x + 3 * a * m * m * f.c2x + m * m * m * f.ox;
      let y = a * a * a * f.y0 + 3 * a * a * m * f.c1y + 3 * a * m * m * f.c2y + m * m * m * f.oy;
      const fix = f.mainEnds < 1 ? smooth(f.fixStarts, 1, u) : 0;
      x += (f.x1 - f.ox) * fix;
      y += (f.y1 - f.oy) * fix;
      s.x = x;
      s.y = y;
      if (u >= 1) {
        s.x = f.x1;
        s.y = f.y1;
        s.flight = null;
        f.resolve();
      }
    }
    // The dart leans into its travel and rights itself as it lands.
    const vx = (s.x - s.prevX) / dt;
    s.prevX = s.x;
    s.lean += (9 * Math.tanh(vx / 1.8) - s.lean) * (1 - Math.exp(-dt / 70));
    // Springs: the press squeezes the dart and lets it bounce back; a scroll
    // nudges it the way the page went.
    const t = dt / 1000;
    const target = s.leaving ? 0.6 : s.pressed ? 0.82 : 1;
    s.scaleV += (-700 * (s.scale - target) - 26 * s.scaleV) * t;
    s.scale += s.scaleV * t;
    s.nudgeV += (-300 * s.nudge - 21 * s.nudgeV) * t;
    s.nudge += s.nudgeV * t;
    body.style.transform = "translate(" + s.x + "px, " + (s.y + s.nudge) + "px)";
    pose.style.transform = "rotate(" + s.lean + "deg) scale(" + s.scale + ")";
    placeTag();
    const settled =
      !s.flight &&
      Math.abs(s.scale - target) < 0.002 &&
      Math.abs(s.scaleV) < 0.02 &&
      Math.abs(s.lean) < 0.05 &&
      Math.abs(s.nudge) < 0.1 &&
      Math.abs(s.nudgeV) < 0.1;
    if (settled) {
      s.last = 0;
      return;
    }
    s.raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  };

  // Glides from where the dart is to a point on a curve that bows to one side,
  // alternating, in a time that grows with the distance as a hand's does,
  // overshooting a little and settling back. Resolves on arrival.
  const fly = (x, y, idle) =>
    new Promise((resolve) => {
      if (s.flight) s.flight.resolve();
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 3 || still() || document.hidden) {
        s.flight = null;
        s.x = x;
        s.y = y;
        wake();
        resolve();
        return;
      }
      const dur = idle ? 1000 + Math.random() * 500 : clamp(80 + 70 * Math.log2(d / 24 + 1), 140, 380);
      s.side = -s.side;
      const nx = -dy / d;
      const ny = dx / d;
      const bow = (idle ? 0.3 : 1) * Math.min(0.1 * d, 30) * smooth(30, 160, d) * s.side;
      const over = idle ? 0 : Math.min(0.03 * d, 4);
      const ox = x + (dx / d) * over;
      const oy = y + (dy / d) * over;
      const flight = {
        x0: s.x,
        y0: s.y,
        c1x: s.x + dx * 0.3 + nx * bow,
        c1y: s.y + dy * 0.3 + ny * bow,
        c2x: s.x + dx * 0.75 + nx * bow * 0.6,
        c2y: s.y + dy * 0.75 + ny * bow * 0.6,
        ox,
        oy,
        x1: x,
        y1: y,
        start: performance.now(),
        dur,
        mainEnds: over > 0 ? 0.8 : 1,
        fixStarts: 0.66,
        resolve,
      };
      s.flight = flight;
      // A page that stops drawing mid-glide still answers.
      setTimeout(resolve, dur + 150);
      wake();
    });

  const stopIdle = () => {
    clearTimeout(s.idle);
    if (s.breathing) {
      s.breathing.cancel();
      s.breathing = null;
    }
  };
  // While the agent thinks, the dart breathes and wanders a few pixels around
  // the last place it acted, so it reads as waiting rather than gone.
  const idleStep = () => {
    if (!s.shown) return;
    if (!s.flight && !s.pressed && s.anchor && !still()) {
      if (!s.breathing) {
        s.breathing = breath.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.05)" }],
          { duration: 1500, direction: "alternate", iterations: Infinity, easing: "ease-in-out" },
        );
      }
      const angle = Math.random() * Math.PI * 2;
      const reach = 4 + Math.random() * 8;
      void fly(s.anchor.x + Math.cos(angle) * reach, s.anchor.y + Math.sin(angle) * reach, true);
    }
    s.idle = setTimeout(idleStep, 2400 + Math.random() * 1800);
  };
  const acting = () => {
    stopIdle();
    s.idle = setTimeout(idleStep, IDLE_AFTER_MS);
  };

  const center = () => ({
    x: Math.round((document.documentElement.clientWidth || innerWidth) / 2),
    y: Math.round((document.documentElement.clientHeight || innerHeight) / 2),
  });
  // Comes in at a point: fading in and popping up from small, or only fading
  // in where it carries on from the document before.
  const show = (point, pop) => {
    if (!host.isConnected) document.documentElement.append(host);
    if (s.shown && !s.leaving) return;
    raise();
    s.shown = true;
    s.leaving = false;
    s.flight = null;
    s.x = s.prevX = point.x;
    s.y = point.y;
    s.anchor = { x: point.x, y: point.y };
    body.style.transition = "opacity 160ms ease-out";
    body.style.opacity = "1";
    if (pop && !still()) {
      s.scale = 0.55;
      s.scaleV = 0;
    }
    wake();
    acting();
  };
  const leave = () => {
    if (!s.shown) return;
    s.shown = false;
    s.leaving = true;
    s.pressed = false;
    stopIdle();
    clearTimeout(s.verb);
    body.style.transition = "opacity 260ms ease-in";
    body.style.opacity = "0";
    wake();
    setTimeout(() => {
      if (s.shown) return;
      s.leaving = false;
      label(config.resting);
      try {
        host.hidePopover();
      } catch {}
    }, 300);
  };

  const pulse = (x, y) => {
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.animate(
      [
        { opacity: 0.9, transform: "scale(0.3)" },
        { opacity: 0, transform: "scale(1.6)" },
      ],
      { duration: 480, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  };

  // Where typing goes: the focused field, through open shadow roots. Null
  // when nothing but the page itself has focus.
  const focused = () => {
    let element = document.activeElement;
    while (element && element.shadowRoot && element.shadowRoot.activeElement) {
      element = element.shadowRoot.activeElement;
    }
    if (!element || element === document.body || element === document.documentElement) {
      return null;
    }
    const r = element.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return r;
  };

  const api = {
    apply(act) {
      switch (act.kind) {
        case "here":
          if (!s.shown || s.leaving) show(center(), true);
          return;
        case "restore":
          show(act, false);
          return;
        case "move":
          // A pointer the agent never placed comes in mid-page and glides
          // to its first point, rather than appearing on it from nowhere.
          if (!s.shown || s.leaving) show(center(), true);
          s.anchor = { x: act.x, y: act.y };
          if (s.pressed) verb("Dragging");
          acting();
          return fly(act.x, act.y, false);
        case "press":
          if (!s.shown || s.leaving) show(act, true);
          s.pressed = true;
          s.anchor = { x: act.x, y: act.y };
          // A press away from the move before it, as one re-aimed into a
          // wrapped link's first line, takes the dart with it.
          if (Math.hypot(act.x - s.x, act.y - s.y) > 3) void fly(act.x, act.y, false);
          raise();
          pulse(act.x, act.y);
          verb("Clicking");
          acting();
          wake();
          return;
        case "release":
          if (!s.shown || s.leaving) show(act, false);
          s.pressed = false;
          raise();
          acting();
          wake();
          return;
        case "scroll": {
          // A wheel with no point of its own scrolls where the pointer is.
          const at = typeof act.x === "number" ? act : null;
          if (!s.shown || s.leaving) show(at || center(), true);
          verb("Scrolling");
          if (at && Math.hypot(at.x - s.x, at.y - s.y) > 40) {
            s.anchor = { x: at.x, y: at.y };
            void fly(at.x, at.y, false);
          }
          s.nudgeV += Math.sign(act.dy) * 160;
          acting();
          wake();
          return;
        }
        case "type": {
          const r = focused();
          if (!s.shown || s.leaving) show(r ? { x: r.left + 16, y: r.top + r.height / 2 } : center(), true);
          verb("Typing");
          if (r && !(s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom)) {
            const x = r.left + Math.min(r.width / 2, Math.max(14, r.width * 0.15));
            const y = r.top + Math.min(r.height / 2, 18);
            s.anchor = { x, y };
            void fly(x, y, false);
          }
          // A tap per key.
          s.scaleV -= 1.4;
          acting();
          wake();
          return;
        }
        case "leave":
          leave();
          return;
        case "hide":
          // Answers once the page has drawn a frame without it, so the
          // screenshot that follows does not catch it on its way out.
          host.style.setProperty("visibility", "hidden", "important");
          return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
            setTimeout(resolve, 100);
          });
        case "unhide":
          host.style.setProperty("visibility", "visible", "important");
          return;
      }
    },
  };
  globalThis.__instrumentAgentPointer = api;
  return api;
}`;
