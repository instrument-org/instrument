// A walkthrough driver for Studio, run inside `studio-drive run` (a walk
// script imports it and calls `createAct(app, { out, viewport })`). It moves a
// real (CDP) pointer the way a hand does, types at a person's pace, records
// the app with the internal repo's capture, and writes beside the capture a
// script track: what the driver meant (chapters, captions, presses, keys,
// camera pushes, stills), which a player or a renderer draws over the replay.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CAPTURE = readFileSync(path.join(HERE, "../vendor/capture.js"), "utf8");
const IN_PAGE = readFileSync(path.join(HERE, "in-page.js"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** A repeatable jitter, so a take types the same way every time. */
function jitter(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export async function createAct(app, { out, viewport }) {
  const { cdp } = app;
  mkdirSync(path.join(out, "stills"), { recursive: true });
  const events = [];
  const script = [];
  const status = [];
  let pos = { x: viewport.w * 0.62, y: viewport.h * 0.55 };
  let recording = false;
  let startedAt = 0;
  const rand = jitter(42);

  const note = (e) => script.push({ t: Date.now(), ...e });

  const evaluate = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    }
    return r.result.value;
  };

  await cdp.send("Runtime.enable");
  await cdp.send("Runtime.addBinding", { name: "__walkthroughSink" });
  cdp.on((message) => {
    if (message.method !== "Runtime.bindingCalled") return;
    if (message.params.name !== "__walkthroughSink") return;
    const payload = JSON.parse(message.params.payload);
    if (payload.kind === "batch") events.push(...payload.events);
    else status.push({ t: Date.now(), ...payload });
  });

  const mouse = (type, x, y, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      ...extra,
    });

  /** Where on a target the hand goes: inside it, off its words where it can be. */
  const aimAt = (box, at) => {
    if (at) return { x: box.x + box.w * at.x, y: box.y + box.h * at.y };
    if (box.kind === "text") return { x: box.x + Math.min(box.w * 0.3, 60), y: box.y + box.h * 0.55 };
    if (box.w <= 56) return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    // A row or a wide button: right of its label, a little below the middle.
    const x = box.textRight != null
      ? clamp(box.textRight + 18, box.x + box.w * 0.55, box.x + box.w - 12)
      : box.x + box.w * 0.78;
    return { x, y: box.y + box.h * 0.6 };
  };

  const locate = async (target) => {
    const box = await evaluate(`window.__walkthroughPage.locate(${JSON.stringify(target)})`);
    if (!box) throw new Error(`Nothing visible for ${JSON.stringify(target)}`);
    if (box.covered) throw new Error(`${JSON.stringify(target)} is covered by ${box.covered}`);
    return box;
  };

  const act = {
    events,
    script,
    evaluate,

    /** Loads the capture and the page helpers, and dresses the app for showing. */
    /** `rootCrumb`: the workspace folder's name, above which the address bar is hidden. */
    async prepare({ presentation = true, rootCrumb } = {}) {
      await evaluate(IN_PAGE);
      await evaluate(CAPTURE);
      await evaluate("window.__walkthroughPage.watchPictures()");
      if (presentation) {
        await evaluate(`window.__walkthroughPage.present(${JSON.stringify({ rootCrumb })})`);
      }
      await mouse("mouseMoved", pos.x, pos.y);
    },

    async begin(meta) {
      await evaluate("window.__walkthrough.start()");
      recording = true;
      startedAt = Date.now();
      note({ kind: "begin", viewport, pointer: pos, ...meta });
      await mouse("mouseMoved", pos.x, pos.y);
    },

    async end() {
      note({ kind: "end" });
      await evaluate("window.__walkthrough.stop()");
      const deadline = Date.now() + 5000;
      while (!status.some((s) => s.kind === "stopped") && Date.now() < deadline) {
        await sleep(50);
      }
      recording = false;
      writeFileSync(
        path.join(out, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      writeFileSync(
        path.join(out, "script.jsonl"),
        script.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      return { events: events.length, script: script.length, ms: Date.now() - startedAt, status };
    },

    async chapter(title, caption) {
      note({ kind: "chapter", title, caption });
    },
    async caption(text) {
      note({ kind: "caption", text });
    },

    hold: (ms) => sleep(ms),

    /** Pushes the camera in on a target's box (or a list of them), or back out with null. */
    async camera(targets, { zoom, ms = 1100 } = {}) {
      if (targets === null) {
        note({ kind: "camera", box: null, ms });
        return;
      }
      const list = Array.isArray(targets) ? targets : [targets];
      const boxes = [];
      for (const t of list) boxes.push(await locate(t));
      const x = Math.min(...boxes.map((one) => one.x));
      const y = Math.min(...boxes.map((one) => one.y));
      const right = Math.max(...boxes.map((one) => one.x + one.w));
      const bottom = Math.max(...boxes.map((one) => one.y + one.h));
      note({ kind: "camera", box: { x, y, w: right - x, h: bottom - y }, zoom, ms });
    },

    /** Moves the pointer in a shallow arc, quicker over short hops. */
    async move(target, { at, ms } = {}) {
      const box = typeof target.x === "number" && target.w === undefined
        ? { x: target.x, y: target.y, w: 0, h: 0 }
        : await locate(target);
      const end = box.w === 0 ? { x: box.x, y: box.y } : aimAt(box, at);
      const from = { ...pos };
      const dist = Math.hypot(end.x - from.x, end.y - from.y);
      if (dist < 1) return box;
      const duration = ms ?? clamp(300 + dist * 0.75, 340, 820);
      const bow = Math.min(dist * 0.08, 28);
      const nx = -(end.y - from.y) / dist;
      const ny = (end.x - from.x) / dist;
      note({ kind: "move", from, to: end, bow, ms: duration, cursor: box.cursor ?? "default" });
      const t0 = Date.now();
      for (;;) {
        const t = Math.min(1, (Date.now() - t0) / duration);
        const e = easeInOutCubic(t);
        const lift = Math.sin(Math.PI * e) * bow;
        pos = {
          x: from.x + (end.x - from.x) * e + nx * lift,
          y: from.y + (end.y - from.y) * e + ny * lift,
        };
        await mouse("mouseMoved", pos.x, pos.y);
        if (t >= 1) break;
        await sleep(12);
      }
      return box;
    },

    /** Rests the pointer on something, for what shows only under a hovering hand. */
    async hover(target, { at, ms = 350 } = {}) {
      const box = await act.move(target, { at });
      note({ kind: "hover", box: { x: box.x, y: box.y, w: box.w, h: box.h }, name: box.name, surface: box.surface ?? null });
      await sleep(ms);
      return box;
    },

    /** What the page has to have to replay elsewhere: its fonts and images, as data. */
    async assets() {
      const assets = await evaluate("window.__walkthroughPage.assets()");
      writeFileSync(path.join(out, "assets.json"), JSON.stringify(assets));
      return Object.keys(assets).length;
    },

    async click(target, { at, right = false, double = false, settle = 260 } = {}) {
      const box = await act.move(target, { at });
      await sleep(120);
      const button = right ? "right" : "left";
      for (let i = 1; i <= (double ? 2 : 1); i++) {
        note({ kind: "press", x: pos.x, y: pos.y, button, name: box.name, box: { x: box.x, y: box.y, w: box.w, h: box.h }, surface: box.surface ?? null });
        await mouse("mousePressed", pos.x, pos.y, { button, buttons: right ? 2 : 1, clickCount: i });
        await sleep(90);
        await mouse("mouseReleased", pos.x, pos.y, { button, buttons: 0, clickCount: i });
        if (double && i === 1) await sleep(70);
      }
      await sleep(settle);
      return box;
    },

    /** Types at a person's pace, a little slower after a space or a comma. */
    async type(text, { cps = 38 } = {}) {
      const { field, surface } = await evaluate(
        "(() => { const el = document.activeElement; const r = el?.getBoundingClientRect(); return { field: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, surface: window.__walkthroughPage.surfaceOf(el) }; })()",
      );
      const t = Date.now();
      const base = 1000 / cps;
      for (const ch of text) {
        await cdp.send("Input.insertText", { text: ch });
        const pause = /[,.]/.test(ch) ? base * 2.2 : ch === " " ? base * 1.4 : base * (0.6 + rand() * 0.8);
        await sleep(pause);
      }
      script.push({ t, kind: "type", text, box: field, surface, ms: Date.now() - t });
    },

    /** A key or a chord, shown as keycaps by the player. */
    async key(combo, { show = true } = {}) {
      const parts = combo.split("+");
      const key = parts.pop();
      const mods = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      const modifiers = parts.reduce((m, p) => m | (mods[p] ?? 0), 0);
      const codes = { Enter: [13, "Enter"], Escape: [27, "Escape"], Tab: [9, "Tab"], ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], Backspace: [8, "Backspace"] };
      const [vk, code] = codes[key] ?? [key.toUpperCase().charCodeAt(0), `Key${key.toUpperCase()}`];
      if (show) note({ kind: "key", combo });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown", key, code, modifiers, windowsVirtualKeyCode: vk,
        ...(key === "Enter" && { text: "\r" }),
      });
      await sleep(60);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
      await sleep(200);
    },

    async waitFor(expression, { timeout = 8000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        if (await evaluate(`Boolean(${expression})`)) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expression}`);
        await sleep(50);
      }
    },

    /**
     * A still: the page as one HTML file, its styles and fonts inside it, and
     * a PNG of the same moment. Noted on the script track so a player can put
     * it on the timeline.
     */
    /** `poster` makes it its chapter's picture, where the snippets page shows it before playing. */
    async still(name, caption, { poster = false } = {}) {
      await sleep(80);
      const t = Date.now();
      const html = await evaluate("window.__walkthroughPage.still()");
      writeFileSync(path.join(out, "stills", `${name}.html`), html);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(out, "stills", `${name}.png`), Buffer.from(data, "base64"));
      script.push({ t, kind: "still", name, caption, bytes: html.length, ...(poster && { poster }) });
    },

    /** Writes a still with no capture running, for a gallery shot outside a take. */
    get recording() {
      return recording;
    },
  };
  return act;
}
