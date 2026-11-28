// A walkthrough driver for Studio, run inside `studio-drive run` (a walk
// script imports it and calls `createAct(app, { out, viewport })`). It moves a
// real (CDP) pointer the way a hand does, types at a person's pace, records
// the app with the internal repo's capture, and writes beside the capture a
// script track: what the driver meant (chapters, captions, presses, keys,
// camera pushes, stills), which a player or a renderer draws over the replay.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  // When the camera's last move lands. The hand acts only after, so what it
  // does is seen at the size the camera was going to.
  let landsAt = 0;
  const landed = () => sleep(Math.max(0, landsAt - Date.now()));
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
    /** `workspace`: the clean room's folder, whose folders above it are hidden in tab group rows and tabs. */
    async prepare({ presentation = true, rootCrumb, workspace } = {}) {
      await evaluate(IN_PAGE);
      await evaluate(CAPTURE);
      await evaluate("window.__walkthroughPage.watchPictures()");
      await evaluate("window.__walkthroughPage.mirrorFocus()");
      if (presentation) {
        const machineFolders = workspace
          ? [...workspace.split(/[\\/]/).filter(Boolean).slice(1), `${path.basename(workspace)}-home`]
          : [];
        await evaluate(`window.__walkthroughPage.present(${JSON.stringify({ rootCrumb, machineFolders })})`);
      }
      await mouse("mouseMoved", pos.x, pos.y);
    },

    async begin(meta) {
      await evaluate("window.__walkthrough.start()");
      recording = true;
      startedAt = Date.now();
      // The app's own UI zoom, which scales its text before any camera does.
      const appZoom = await evaluate(APP_ZOOM);
      note({ kind: "begin", viewport, pointer: pos, appZoom, ...meta });
      await mouse("mouseMoved", pos.x, pos.y);
    },

    async end() {
      note({ kind: "end" });
      const assets = await act.assets();
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
      return { assets, events: events.length, script: script.length, ms: Date.now() - startedAt, status };
    },

    async chapter(title, caption) {
      note({ kind: "chapter", title, caption });
    },
    async caption(text) {
      note({ kind: "caption", text });
    },

    hold: (ms) => sleep(ms),

    /**
     * Pushes the camera in on a target's box (or a list of them), or back out
     * with null. A target may be a box itself, `{ x, y, w, h }` or
     * `{ box: { x, y, w, h } }`, in the window's pixels. `tight` frames the box edge to edge, with no
     * margin around it.
     */
    async camera(targets, { ms = 1100, tight = false, zoom } = {}) {
      landsAt = Date.now() + ms;
      if (targets === null) {
        note({ kind: "camera", box: null, ms });
        return;
      }
      const list = Array.isArray(targets) ? targets : [targets];
      const boxes = [];
      for (const t of list) boxes.push(typeof t.w === "number" ? t : (t.box ?? (await locate(t))));
      const x = Math.min(...boxes.map((one) => one.x));
      const y = Math.min(...boxes.map((one) => one.y));
      const right = Math.max(...boxes.map((one) => one.x + one.w));
      const bottom = Math.max(...boxes.map((one) => one.y + one.h));
      note({ kind: "camera", box: { x, y, w: right - x, h: bottom - y }, zoom, ms, ...(tight && { padded: true }) });
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
      await landed();
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

    /** `ms` is how long the hand takes to get there, for a hop that should not linger. */
    async click(target, { at, right = false, double = false, ms, settle = 260 } = {}) {
      const box = await act.move(target, { at, ms });
      await landed();
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
      await landed();
      const { field, plain, surface } = await evaluate(
        "(() => { const el = document.activeElement; const r = el?.getBoundingClientRect(); return { field: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, plain: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement, surface: window.__walkthroughPage.surfaceOf(el) }; })()",
      );
      const t = Date.now();
      const base = 1000 / cps;
      for (const ch of text) {
        await cdp.send("Input.insertText", { text: ch });
        // The capture sees a field's value when a script sets it, and React
        // never sets a controlled field a person types into, so the replay
        // would show it empty: set it to itself.
        if (plain) await evaluate("(() => { const el = document.activeElement; el.value = el.value; })()");
        const pause = /[,.]/.test(ch) ? base * 2.2 : ch === " " ? base * 1.4 : base * (0.6 + rand() * 0.8);
        await sleep(pause);
      }
      script.push({ t, kind: "type", text, box: field, surface, ms: Date.now() - t });
    },

    /** A key or a chord, shown as keycaps by the player. */
    async key(combo, { show = true } = {}) {
      await landed();
      const parts = combo.split("+");
      const key = parts.pop();
      const mods = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      const modifiers = parts.reduce((m, p) => m | (mods[p] ?? 0), 0);
      const codes = { Enter: [13, "Enter"], Escape: [27, "Escape"], Tab: [9, "Tab"], ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], Backspace: [8, "Backspace"] };
      const [vk, code] = codes[key] ?? [key.toUpperCase().charCodeAt(0), /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`];
      // A character with no Alt, Control or Meta types itself, as studio-drive's press does.
      const typed = key.length === 1 && (modifiers & 7) === 0;
      if (show) note({ kind: "key", combo });
      await cdp.send("Input.dispatchKeyEvent", {
        type: typed ? "keyDown" : "rawKeyDown", key, code, modifiers, windowsVirtualKeyCode: vk,
        ...(key === "Enter" && { text: "\r" }),
        ...(typed && { text: key }),
      });
      await sleep(60);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
      await sleep(200);
    },

    /**
     * A chord the app's menu bar answers (⌘T, ⇧⌘W, ⌘N), which a key sent to
     * the page alone never reaches, pressed as studio-drive presses it and
     * shown as keycaps like `key`.
     */
    async chord(combo) {
      await landed();
      note({ kind: "key", combo });
      await app.words.press(combo);
      await sleep(200);
    },

    /**
     * A target's box once the page holds still (a sidebar closing or a pane
     * opening animates), grown by `pad` on each side, for a camera push.
     */
    async box(target, { pad = 0 } = {}) {
      let box = await locate(target);
      for (let same = 0, at = Date.now(); same < 2 && Date.now() - at < 5000; ) {
        await sleep(250);
        const next = await locate(target);
        same = ["x", "y", "w", "h"].every((k) => Math.abs(next[k] - box[k]) < 1) ? same + 1 : 0;
        box = next;
      }
      return { h: box.h + pad * 2, w: box.w + pad * 2, x: box.x - pad, y: box.y - pad };
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

const APP_ZOOM = `parseFloat([...document.querySelectorAll("[style]")].find((e) => e.style.getPropertyValue("--app-zoom"))?.style.getPropertyValue("--app-zoom")) || 1`;

/**
 * Sets the app's UI zoom with its own zoom chords, a rung of its ladder at a
 * time (1.1, 1.25, 1.5, 1.75, 2), which apply at once and are kept. Setting
 * the kept value and reloading instead stops every studio-drive word after it.
 */
export async function uiZoom(app, zoom) {
  for (let i = 0; i < 12; i++) {
    const now = await app.eval(APP_ZOOM);
    if (Math.abs(now - zoom) < 0.01) break;
    await app.words.press(now < zoom ? "Meta+=" : "Meta+-");
    await sleep(400);
  }
  const reached = await app.eval(APP_ZOOM);
  if (Math.abs(reached - zoom) >= 0.01) throw new Error(`UI zoom stopped at ${reached}: ${zoom} is not a rung of the app's ladder`);
  await sleep(500);
}

/** An expression's value once the page holds still: three readings in a row, a quarter second apart, that agree. */
export async function settled(app, expression) {
  const read = async () => JSON.stringify(await app.eval(expression));
  let value = await read();
  for (let same = 0; same < 2; ) {
    await sleep(250);
    const next = await read();
    same = next === value ? same + 1 : 0;
    value = next;
  }
  return JSON.parse(value);
}

/**
 * Records a feature clip: the take opens on `wide` (the pane or side the
 * feature is in, and the sidebar when it lives there; the whole window when
 * not given), holds there `hold` ms, and pushes in on `close` as the hand
 * sets off, landing before the hand acts. `close` may be a function of the
 * act, for a box measured once the page holds still (`act.box`). `pointer`
 * is where the hand waits. Returns what `act.end` does, with `failed` when
 * the walk threw.
 */
export async function recordClip(
  app,
  args,
  { title, wide, close, zoom, hold = 400, ms = 700, pointer, rootCrumb = true, viewport = { h: 840, w: 1240 } },
  walk,
) {
  const act = await createAct(app, { out: args.out, viewport });
  await act.prepare({
    ...(rootCrumb && { rootCrumb: path.basename(args.workspace) }),
    workspace: args.workspace,
  });
  // Presentation hides the developer strip, which moves what is anchored to
  // the window's foot: measure only once it has.
  await sleep(600);
  const closeBox = typeof close === "function" ? await close(act) : close;
  await act.move(pointer ?? { x: viewport.w - 4, y: viewport.h - 4 }, { ms: 1 });
  if (wide) await act.camera(wide, { ms: 1 });
  await act.begin({ title, build: args.build });
  try {
    await act.chapter(title, "");
    if (closeBox) {
      await act.hold(hold);
      await act.camera(closeBox, { ms, zoom });
    }
    await walk(act);
    const summary = await act.end();
    return { ...summary, status: summary.status.map((s) => s.kind) };
  } catch (error) {
    const summary = await act.end();
    return { failed: String(error), ...summary, status: summary.status.map((s) => s.kind) };
  }
}
