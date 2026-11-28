// Judges a feature clip the way a person meets it: once, small, in What's
// new, where it plays at most 448 pixels wide. Three things sink a clip
// there, and each is measured rather than eyeballed from a full-size frame:
//
//   time   nothing happening at the start, in the middle, or at the end
//   size   the app's text too small to read at that width
//   length longer than a glance
//
// Motion is the mean change per pixel between frames a tenth of a second
// apart, on a small gray copy of the clip: a pointer moving alone stays under
// 0.06, and anything in the app changing (a menu, a check mark, the camera
// moving) goes over 0.25. The strip it writes is the clip at its real size in
// What's new, a frame every half second, each stamped with how large the
// app's body text shows in it.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { launch } from "./browser.mjs";

/** How wide What's new shows a clip, in CSS pixels (`max-w-md`). */
export const DISPLAY_WIDTH = 448;
/** Studio's body text, in its own pixels at a UI zoom of 1. */
const BODY_TEXT = 14;
/** Above this, something in the frame changed between samples. */
const MOTION = 0.25;
const STEP = 100;

export const LIMITS = {
  /** From the first frame to the first change. */
  leadMs: 600,
  /** The longest stretch with nothing changing, between the first change and the last. */
  deadMs: 1200,
  /** From the last change to the end, the result held. */
  tailMs: 1600,
  lengthMs: 9000,
  /** The app's body text, as shown, where the hand or a key acts. */
  textPx: 8.5,
};

const run = (args, { binary = false } = {}) =>
  new Promise((resolve, reject) => {
    const job = spawn("ffmpeg", ["-v", "error", ...args], { stdio: ["ignore", "pipe", "inherit"] });
    const chunks = [];
    job.stdout.on("data", (c) => chunks.push(c));
    job.on("close", (code) =>
      code === 0 ? resolve(binary ? Buffer.concat(chunks) : null) : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });

/** The change between each sample and the one before it, every STEP ms. */
async function motionOf(file) {
  const w = 160;
  const h = 106;
  const raw = await run(
    ["-i", file, "-vf", `fps=${1000 / STEP},scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"],
    { binary: true },
  );
  const n = w * h;
  const frames = raw.length / n;
  const changes = [];
  for (let i = 1; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += Math.abs(raw[i * n + j] - raw[(i - 1) * n + j]);
    changes.push({ d: sum / n, t: i * STEP });
  }
  return { changes, lengthMs: frames * STEP };
}

/** How large the app's body text shows at a camera scale, in What's new. */
const shownText = (s, { appZoom, viewportWidth }) => (BODY_TEXT * appZoom * s * DISPLAY_WIDTH) / viewportWidth;

/**
 * @param {string} file the clip
 * @param {{ actions?: { kind: string, p: number }[], appZoom?: number, scales?: number[], fps?: number, viewportWidth?: number, strip?: string }} info
 *   what the render knew: when the hand or a key acted, the app's UI zoom,
 *   and the camera's scale on every frame; without them only time and length
 *   are judged
 */
export async function checkClip(file, { actions = [], appZoom = 1, fps = 30, scales = [], strip, viewportWidth = 1240 } = {}) {
  const { changes, lengthMs } = await motionOf(file);
  const on = changes.filter((c) => c.d > MOTION).map((c) => c.t);
  const first = on[0] ?? lengthMs;
  const last = on.at(-1) ?? 0;
  let dead = { from: 0, ms: 0 };
  for (let i = 1; i < on.length; i++) {
    const gap = on[i] - on[i - 1] - STEP;
    if (gap > dead.ms) dead = { from: on[i - 1], ms: gap };
  }
  const scaleAt = (ms) => scales[clamp(Math.round((ms / 1000) * fps), 0, scales.length - 1)] ?? 1;
  const textAt = (ms) => round1(shownText(scaleAt(ms), { appZoom, viewportWidth }));
  const actionText = actions.map((a) => ({ ...a, text: textAt(a.p) }));
  const smallest = actionText.reduce((min, a) => (a.text < (min?.text ?? Infinity) ? a : min), null);

  const measured = {
    deadMs: dead.ms,
    deadFromMs: dead.from,
    leadMs: first,
    lengthMs,
    tailMs: lengthMs - last,
    ...(scales.length && { textPx: smallest?.text ?? textAt(lengthMs / 2) }),
  };
  const fails = [];
  const at = (ms) => `${(ms / 1000).toFixed(1)}s`;
  if (measured.leadMs > LIMITS.leadMs) {
    fails.push(`FAIL lead: nothing changes for the first ${at(measured.leadMs)} (limit ${at(LIMITS.leadMs)}) -> start the take on the action, or start the push from the wide opening sooner (recordClip's hold)`);
  }
  if (measured.deadMs > LIMITS.deadMs) {
    fails.push(`FAIL dead: nothing changes for ${at(measured.deadMs)} from ${at(measured.deadFromMs)} (limit ${at(LIMITS.deadMs)}) -> cut the hold, or move the camera to what comes next`);
  }
  if (measured.tailMs > LIMITS.tailMs) {
    fails.push(`FAIL tail: the last ${at(measured.tailMs)} hold still (limit ${at(LIMITS.tailMs)}) -> end the take sooner after the result shows`);
  }
  if (measured.lengthMs > LIMITS.lengthMs) {
    fails.push(`FAIL length: ${at(measured.lengthMs)} (limit ${at(LIMITS.lengthMs)}) -> show one thing; a second idea is a second clip`);
  }
  if (scales.length && measured.textPx < LIMITS.textPx) {
    const where = smallest ? ` at the ${smallest.kind} at ${at(smallest.p)}` : "";
    fails.push(`FAIL text: body text shows at ${measured.textPx}px${where} in What's new (limit ${LIMITS.textPx}px) -> push the camera in to about ${round1((LIMITS.textPx * viewportWidth) / (BODY_TEXT * appZoom * DISPLAY_WIDTH))}x there, framing ${Math.round((BODY_TEXT * appZoom * DISPLAY_WIDTH) / LIMITS.textPx)} of the window's pixels across at most, or raise the app's UI zoom`);
  }
  if (strip) await writeStrip(file, strip, { textAt: scales.length ? textAt : null });
  return { fails, measured, ...(strip && { strip }) };
}

/** The clip at What's new's size, a frame every half second, stamped. */
async function writeStrip(file, out, { textAt }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clip-strip-"));
  try {
    await run(["-i", file, "-vf", `fps=2,scale=${DISPLAY_WIDTH * 2}:-2`, "-q:v", "3", path.join(dir, "%03d.jpg")]);
    const frames = readdirSync(dir)
      .sort()
      .map((name, i) => ({ ms: i * 500, src: `data:image/jpeg;base64,${readFileSync(path.join(dir, name)).toString("base64")}` }));
    const columns = 4;
    const browser = await launch();
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { height: 400, width: columns * (DISPLAY_WIDTH + 10) + 10 },
    });
    await page.setContent(`<!doctype html><body style="margin:0;background:#1b1b1b;font:600 11px system-ui;color:#fff">
<div style="display:grid;grid-template-columns:repeat(${columns},${DISPLAY_WIDTH}px);gap:10px;padding:10px">
${frames
  .map(
    (f) =>
      `<figure style="margin:0"><img src="${f.src}" style="width:${DISPLAY_WIDTH}px;display:block;border-radius:8px"><figcaption style="padding:3px 2px;opacity:.75">${(f.ms / 1000).toFixed(1)}s${textAt ? ` · text ${textAt(f.ms)}px` : ""}</figcaption></figure>`,
  )
  .join("\n")}
</div></body>`);
    await page.screenshot({ fullPage: true, path: out });
    await browser.close();
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;
