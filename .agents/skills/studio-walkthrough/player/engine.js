// The walkthrough engine: an rrweb replay of Studio driven by our own clock,
// with what the driver meant drawn over it (the cursor and its presses, keys,
// captions, the camera). Every frame seeks the replay to a recording time, so
// a live player, a looping snippet and a frame-by-frame video render are the
// same code at different clocks.

import "@rrweb/replay/dist/style.css";
import { Replayer } from "@rrweb/replay";

const SVG = "http://www.w3.org/2000/svg";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** cubic-bezier(x1, y1, x2, y2) as a function of time, as CSS works it out. */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (u) => ((ax * u + bx) * u + cx) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  const y = (u) => ((ay * u + by) * u + cy) * u;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= (x(u) - t) / d;
    }
    return y(clamp(u, 0, 1));
  };
}
const CAMERA_EASE = bezier(0.45, 0, 0.1, 1);

const ARROW = `<svg viewBox="0 0 28 28" width="28" height="28"><path d="M6 3.5v18.2l4.6-4.4 3 6.9 3.1-1.3-3-6.8h6.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const IBEAM = `<svg viewBox="0 0 28 28" width="28" height="28"><path d="M10 5.5c2 0 3.3.6 4 1.6.7-1 2-1.6 4-1.6M10 22.5c2 0 3.3-.6 4-1.6.7 1 2 1.6 4 1.6M14 7v14M11.5 14h5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M10 5.5c2 0 3.3.6 4 1.6.7-1 2-1.6 4-1.6M10 22.5c2 0 3.3-.6 4-1.6.7 1 2 1.6 4 1.6M14 7v14M11.5 14h5" fill="none" stroke="#111" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const HAND = `<svg viewBox="0 0 28 28" width="28" height="28"><path d="M11 13V5.6a1.7 1.7 0 0 1 3.4 0V12m0-1.4a1.7 1.7 0 0 1 3.4 0V13m0-1a1.7 1.7 0 0 1 3.4 0v5.4c0 3.7-2.5 6.6-6.3 6.6h-1.6c-2.3 0-3.8-1-5-2.8l-2.6-4a1.7 1.7 0 0 1 2.7-2L11 17" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

/** Where each glyph's hotspot sits, in its 28px box. */
const HOTSPOT = { arrow: [6, 3.5], ibeam: [14, 14], hand: [12.5, 4] };

const KEY_GLYPHS = { Alt: "⌥", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", Backspace: "⌫", Control: "⌃", Enter: "⏎ Return", Escape: "Esc", Meta: "⌘", Shift: "⇧", Tab: "⇥" };

/**
 * Where the camera goes, as keyframes ({ t, box or null, zoom, ms }): the
 * script's own pushes where it has them, and elsewhere a push of the
 * camera's own onto any stretch where the hand keeps working in one small
 * area (a dialog, a row and its menu, a field being typed into), back out as
 * the hand sets off for somewhere else.
 */
function cameraPlan(script, w, h) {
  const explicit = script.filter((e) => e.kind === "camera");
  // What the script's own pushes hold, from each push to its pull-out.
  const held = [];
  for (const [i, e] of explicit.entries()) {
    if (!e.box) continue;
    const out = explicit.slice(i + 1).find((x) => !x.box);
    held.push({ from: e.t - 400, to: (out?.t ?? Infinity) + (out?.ms ?? 1100) });
  }
  const union = (a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { h: Math.max(a.y + a.h, b.y + b.h) - y, w: Math.max(a.x + a.w, b.x + b.w) - x, x, y };
  };
  // Beats: where the hand did something, framed with what it was on (its
  // dialog, menu or popover), from when it set off for it, once the take has
  // begun (a script's pre-roll is not filmed).
  const begun = script.find((e) => e.kind === "begin")?.t ?? -Infinity;
  const chapters = script.filter((e) => e.kind === "chapter").map((e) => e.t);
  const beats = [];
  let lastMove = null;
  for (const e of script.filter((x) => x.t >= begun)) {
    if (e.kind === "move") lastMove = e;
    const box = e.box && (e.surface ? union(e.box, e.surface) : e.box);
    if ((e.kind === "press" || e.kind === "hover") && box) {
      const from = lastMove && e.t - lastMove.t < 2000 ? lastMove.t : e.t;
      beats.push({ box, end: e.t, from, typing: false });
    }
    if (e.kind === "type" && box) {
      beats.push({ box, end: e.t + (e.ms ?? 0), from: e.t, typing: true });
    }
  }
  // Neighbouring beats in one chapter whose boxes, together, stay a small
  // part of the screen.
  const chapterOf = (t) => chapters.filter((c) => c <= t).length;
  const shots = [];
  let current = null;
  for (const b of beats) {
    if (current) {
      const u = union(current.box, b.box);
      if (
        u.w <= w * 0.62 &&
        u.h <= h * 0.72 &&
        b.from - current.end <= 1500 &&
        chapterOf(b.from) === current.chapter
      ) {
        current.box = u;
        current.end = Math.max(current.end, b.end);
        current.beats += 1;
        current.typing ||= b.typing;
        continue;
      }
      shots.push(current);
    }
    current = { beats: 1, box: { ...b.box }, chapter: chapterOf(b.from), end: b.end, from: b.from, typing: b.typing };
  }
  if (current) shots.push(current);
  const frames = [];
  for (const [i, shot] of shots.entries()) {
    if (shot.beats < 2 && !shot.typing) continue;
    const pad = 48;
    const box = { h: shot.box.h + pad * 2, w: shot.box.w + pad * 2, x: shot.box.x - pad, y: shot.box.y - pad };
    const zoom = Math.min(1.7, w / box.w, h / box.h);
    if (zoom < 1.15) continue;
    // A chapter opens wide for a moment before anything is pushed in on.
    const opened = chapters.findLast((c) => c <= shot.from) ?? begun;
    let from = Math.max(shot.from - 250, opened + 1200);
    // Out a beat after the last thing done there, or as the hand sets off
    // for the next shot if that comes first.
    let to = Math.min(shot.end + 800, (shots[i + 1]?.from ?? Infinity) - 250);
    // The script's own pushes win: a shot gives way where one holds.
    for (const x of held) {
      if (from >= x.from && from < x.to) from = x.to;
      if (to > x.from && from < x.from) to = x.from;
    }
    if (to - from < 1400) continue;
    frames.push({ box, ms: 850, padded: true, t: from, zoom }, { box: null, ms: 850, t: to });
  }
  // A pull-out with the next push close behind it pans across instead.
  const merged = frames.filter(
    (f, i) => f.box || !(frames[i + 1]?.box && frames[i + 1].t - f.t < 1200),
  );
  return [...explicit, ...merged].sort((a, b) => a.t - b.t);
}

/**
 * @param {HTMLElement} root
 * @param {import("./types").Take & Record<string, any>} data
 * @param {import("./types").EngineOptions} [options]
 * @returns {import("./types").Engine}
 */
export function createEngine(root, data, options = {}) {
  const { w, h } = data.viewport;
  const mode = options.mode ?? "full";
  const showCaptions = options.captions !== false;
  const useCamera = options.camera !== false;

  // --- the frame ------------------------------------------------------------
  root.classList.add("wt-frame");
  root.innerHTML = "";
  const fit = document.createElement("div");
  fit.className = "wt-fit";
  fit.style.width = `${w}px`;
  fit.style.height = `${h}px`;
  const camera = document.createElement("div");
  camera.className = "wt-camera";
  const replayRoot = document.createElement("div");
  replayRoot.className = "wt-replay";
  const overlay = document.createElementNS(SVG, "svg");
  overlay.setAttribute("class", "wt-overlay");
  overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
  overlay.setAttribute("width", w);
  overlay.setAttribute("height", h);
  const cursor = document.createElement("div");
  cursor.className = "wt-cursor";
  camera.append(replayRoot, overlay, cursor);
  const hud = document.createElement("div");
  hud.className = "wt-hud";
  hud.innerHTML = `
    <div class="wt-caption" hidden></div>
    <div class="wt-keys" hidden></div>
    <div class="wt-warp" hidden>Waiting for the answer, sped up</div>`;
  fit.append(camera, hud);
  root.append(fit);
  const captionEl = hud.querySelector(".wt-caption");
  const keysEl = hud.querySelector(".wt-keys");
  const warpEl = hud.querySelector(".wt-warp");

  const resize = () => {
    const box = root.getBoundingClientRect();
    const s = Math.min(box.width / w, box.height / h);
    fit.style.transform = `translate(${(box.width - w * s) / 2}px, ${(box.height - h * s) / 2}px) scale(${s})`;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // --- the replay -----------------------------------------------------------
  // The take's pictures, kept once each, are put back where it names them.
  let events = data.events;
  if (data.pictures?.length) {
    data.pictureUrls ??= data.pictures.map((uri) => {
      const [head, body] = uri.split(",");
      const mime = head.slice(5).split(";")[0];
      const bytes = head.includes(";base64")
        ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(body));
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
    events = JSON.parse(
      JSON.stringify(events).replace(/wt-asset:(\d+)/g, (_, n) => data.pictureUrls[Number(n)] ?? ""),
    );
  }
  const replayer = new Replayer(events, {
    mouseTail: false,
    pauseAnimation: false,
    root: replayRoot,
    showWarning: false,
    skipInactive: false,
    triggerFocus: false,
    UNSAFE_replayCanvas: false,
  });
  // rrweb leaves the frame's document open once it has written it, and a
  // document still loading never says its fonts are ready.
  replayer.on("fullsnapshot-rebuilded", () => {
    try {
      replayer.iframe.contentDocument?.close();
    } catch {}
  });
  let shown = -1;
  const seek = (r) => {
    const at = Math.round(r);
    if (at === shown) return;
    replayer.pause(Math.max(1, at));
    shown = at;
  };

  // --- what the driver meant, on the recording's clock ---------------------
  const script = data.script;
  const moves = script.filter((e) => e.kind === "move");
  const presses = script.filter((e) => e.kind === "press");
  const keys = script.filter((e) => e.kind === "key");
  const captions = script.filter((e) => e.kind === "caption");
  const cameras = cameraPlan(script, w, h);
  const begin = script.find((e) => e.kind === "begin");
  const chapters = data.chapters;

  const pointerAt = (r) => {
    let pos = begin?.pointer ?? { x: w * 0.6, y: h * 0.55 };
    let kind = "arrow";
    for (const m of moves) {
      if (m.t > r) break;
      const t = clamp((r - m.t) / m.ms, 0, 1);
      const e = easeInOutCubic(t);
      const dist = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) || 1;
      const nx = -(m.to.y - m.from.y) / dist;
      const ny = (m.to.x - m.from.x) / dist;
      const lift = Math.sin(Math.PI * e) * m.bow;
      pos = {
        x: m.from.x + (m.to.x - m.from.x) * e + nx * lift,
        y: m.from.y + (m.to.y - m.from.y) * e + ny * lift,
      };
      const target = m.cursor === "text" ? "ibeam" : m.cursor === "pointer" ? "hand" : "arrow";
      // The kind changes as the hand crosses into its target, not after.
      if (t > 0.8) kind = target;
      else if (t > 0) kind = kind;
    }
    return { ...pos, kind };
  };

  const cameraAt = (r) => {
    const rest = { cx: w / 2, cy: h / 2, s: 1 };
    const target = (ev) => {
      if (!ev?.box) return rest;
      const b = ev.box;
      // A push of the camera's own comes with its margin already.
      const pad = ev.padded ? 1 : 1.18;
      const s = clamp(Math.min(ev.zoom ?? 1.5, w / (b.w * pad), h / (b.h * pad)), 1, 2.4);
      return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, s };
    };
    let state = rest;
    for (const ev of cameras) {
      if (ev.t > r) break;
      const from = state;
      const to = target(ev);
      const k = CAMERA_EASE(clamp((r - ev.t) / (ev.ms ?? 1100), 0, 1));
      state = {
        cx: from.cx + (to.cx - from.cx) * k,
        cy: from.cy + (to.cy - from.cy) * k,
        s: Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * k),
      };
    }
    let tx = w / 2 - state.s * state.cx;
    let ty = h / 2 - state.s * state.cy;
    tx = clamp(tx, w - state.s * w, 0);
    ty = clamp(ty, h - state.s * h, 0);
    return { s: state.s, tx, ty };
  };

  // --- drawing ----------------------------------------------------------------
  let glyph = "";
  const draw = (r) => {
    seek(r);

    const cam = useCamera ? cameraAt(r) : { s: 1, tx: 0, ty: 0 };
    camera.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`;

    const p = pointerAt(r);
    if (glyph !== p.kind) {
      glyph = p.kind;
      cursor.innerHTML = p.kind === "ibeam" ? IBEAM : p.kind === "hand" ? HAND : ARROW;
    }
    const pressed = presses.some((q) => r >= q.t - 10 && r <= q.t + 110);
    const [hx, hy] = HOTSPOT[p.kind];
    cursor.style.transform = `translate(${p.x - hx}px, ${p.y - hy}px) scale(${pressed ? 0.88 : 1})`;
    cursor.style.transformOrigin = `${hx}px ${hy}px`;
    const idle = moves.length && r > (moves.at(-1).t + moves.at(-1).ms + 4000) && !presses.some((q) => q.t > r - 4000);
    cursor.style.opacity = idle ? "0" : "1";

    overlay.replaceChildren();
    for (const q of presses) {
      const k = (r - q.t) / 520;
      if (k < 0 || k > 1) continue;
      const ring = document.createElementNS(SVG, "circle");
      ring.setAttribute("cx", q.x);
      ring.setAttribute("cy", q.y);
      ring.setAttribute("r", String(6 + 20 * (1 - Math.pow(1 - k, 3))));
      ring.setAttribute("class", "wt-ring");
      ring.setAttribute("opacity", String(0.55 * (1 - k)));
      overlay.append(ring);
    }

    // Captions, keys and the sped-up wait, on the screen.
    const chapter = chapters.findLast((c) => c.from <= r) ?? chapters[0];
    const sinceChapter = chapter ? r - chapter.from : Infinity;
    const cue = captions.findLast((c) => c.t <= r && r - c.t < 4200);
    const chapterCue = chapter && sinceChapter >= 0 && sinceChapter < 5200 ? chapter.caption : null;
    const text = showCaptions ? (cue?.text ?? chapterCue) : null;
    captionEl.hidden = !text;
    if (text && captionEl.textContent !== text) captionEl.textContent = text;
    const key = keys.findLast((k) => k.t <= r && r - k.t < 1300);
    keysEl.hidden = !key;
    if (key) {
      const label = key.combo.split("+").map((k) => KEY_GLYPHS[k] ?? k.toUpperCase());
      const html = label.map((k) => `<kbd>${k}</kbd>`).join("");
      if (keysEl.innerHTML !== html) keysEl.innerHTML = html;
      keysEl.style.opacity = String(clamp((1300 - (r - key.t)) / 300, 0, 1));
    }
    const warp = data.warps.find((x) => r >= x.from && r < x.to);
    warpEl.hidden = !warp || !showCaptions;
  };

  // --- clocks -----------------------------------------------------------------
  // Presentation time runs through the warps faster; recording time is what
  // the replay and the script are on.
  const warps = data.warps;
  const toRec = (p, from = 0) => {
    let r = from;
    let left = p;
    for (const x of warps) {
      if (x.to <= r) continue;
      const before = Math.max(0, x.from - r);
      if (left <= before) return r + left;
      left -= before;
      r = Math.max(r, x.from);
      const span = (x.to - r) / x.rate;
      if (left <= span) return r + left * x.rate;
      left -= span;
      r = x.to;
    }
    return r + left;
  };
  const toPres = (r, from = 0) => {
    let p = 0;
    let at = from;
    for (const x of warps) {
      if (x.to <= at) continue;
      if (r <= x.from) break;
      p += Math.max(0, x.from - at);
      at = Math.max(at, x.from);
      const end = Math.min(r, x.to);
      p += (end - at) / x.rate;
      at = end;
      if (r <= x.to) return p;
    }
    return p + (r - at);
  };

  const range = options.range ?? { from: 0, to: data.duration };
  const length = toPres(range.to, range.from);
  let p = 0;
  let playing = false;
  let speed = 1;
  let last = 0;
  let raf = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(api.state()));

  const tick = (now) => {
    if (!playing) return;
    const dt = last ? now - last : 0;
    last = now;
    p += dt * speed;
    if (p >= length) {
      if (options.loop) p = (p - length) % length;
      else {
        p = length;
        playing = false;
      }
    }
    draw(toRec(p, range.from));
    emit();
    if (playing) raf = requestAnimationFrame(tick);
  };

  const api = {
    replayer,
    length,
    range,
    state: () => ({ p, r: toRec(p, range.from), playing, length, speed }),
    on(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    play() {
      if (playing) return;
      if (p >= length) p = 0;
      playing = true;
      last = 0;
      raf = requestAnimationFrame(tick);
      emit();
    },
    pause() {
      playing = false;
      cancelAnimationFrame(raf);
      emit();
    },
    toggle() {
      playing ? api.pause() : api.play();
    },
    seekPres(ms) {
      p = clamp(ms, 0, length);
      draw(toRec(p, range.from));
      emit();
    },
    seekRec(r) {
      api.seekPres(toPres(clamp(r, range.from, range.to), range.from));
    },
    setSpeed(s) {
      speed = s;
      emit();
    },
    toPres: (r) => toPres(r, range.from),
    /** The replay's page as one HTML file: a still pulled from any moment. */
    stillHtml() {
      const doc = replayer.iframe.contentDocument;
      return "<!doctype html>\n" + doc.documentElement.outerHTML;
    },
    destroy() {
      api.pause();
      ro.disconnect();
      replayer.destroy();
    },
  };
  draw(toRec(0, range.from));
  return api;
}
