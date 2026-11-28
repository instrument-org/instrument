// The app window's own pixels, web pages included: the frames CDP's screencast
// sends each time the window paints, kept beside a take's recording as one
// video, `recording/pixels.mp4`, and `recording/pixels.json`, the wall-clock
// time (ms, the clock rrweb's events use) of each of its frames in order.
//
// The video's frames sit at those times less the first one's, so a player
// shows the frame painted by a moment at `(moment - start) / 1000` seconds,
// and a render takes them out one picture each, in the same order.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A folder outside the take for the raw frames, which come to tens of MB a few seconds. */
export const framesDir = () => mkdtempSync(path.join(tmpdir(), "walkthrough-pixels-"));

function run(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ffmpeg.stderr.on("data", (d) => (err += d));
    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
  });
}

/**
 * Encodes the raw frames (`{ file, ts }`, in `dir`) into `<out>/pixels.mp4`
 * at their own times, writes `<out>/pixels.json`, and removes `dir`.
 */
export async function encodePixels({ dir, frames, out }) {
  // Two frames in one millisecond would share a timestamp in the video; the later one is what showed.
  const kept = frames.filter((f, i) => Math.round(frames[i + 1]?.ts ?? Infinity) !== Math.round(f.ts));
  if (!kept.length) {
    rmSync(dir, { force: true, recursive: true });
    return null;
  }
  const start = kept[0].ts;
  const list = kept
    .map((f, i) => {
      const next = kept[i + 1]?.ts ?? f.ts + 100;
      return `file '${path.join(dir, f.file)}'\nduration ${((next - f.ts) / 1000).toFixed(3)}`;
    })
    .join("\n");
  writeFileSync(path.join(dir, "list.txt"), `ffconcat version 1.0\n${list}\n`);
  await run([
    "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
    "-fps_mode", "passthrough", "-video_track_timescale", "1000",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    path.join(out, "pixels.mp4"),
  ]);
  writeFileSync(path.join(out, "pixels.json"), JSON.stringify({ frames: kept.map((f) => Math.round(f.ts)), start: Math.round(start) }));
  const rawKb = Math.round(frames.reduce((sum, f) => sum + statSync(path.join(dir, f.file)).size, 0) / 1024);
  rmSync(dir, { force: true, recursive: true });
  return { frames: kept.length, kb: Math.round(statSync(path.join(out, "pixels.mp4")).size / 1024), rawKb };
}

/** The take's pixel times, or null for a take without them. */
export function readPixels(take) {
  const json = path.join(take, "recording", "pixels.json");
  if (!existsSync(json) || !existsSync(path.join(take, "recording", "pixels.mp4"))) return null;
  return JSON.parse(readFileSync(json, "utf8"));
}

/**
 * The take's frames taken out of its video into a temporary folder, one
 * picture each, with the index of the frame painted by a wall-clock moment.
 */
export async function extractPixels(take) {
  const pixels = readPixels(take);
  if (!pixels) return null;
  const dir = framesDir();
  await run(["-i", path.join(take, "recording", "pixels.mp4"), "-fps_mode", "passthrough", "-q:v", "2", path.join(dir, "%05d.jpg")]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  if (files.length !== pixels.frames.length) {
    rmSync(dir, { force: true, recursive: true });
    throw new Error(`pixels.mp4 holds ${files.length} frames, pixels.json times ${pixels.frames.length}`);
  }
  const indexAt = (wall) => {
    let lo = 0;
    let hi = pixels.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pixels.frames[mid] <= wall) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { dir, done: () => rmSync(dir, { force: true, recursive: true }), file: (i) => path.join(dir, files[i]), indexAt };
}

/**
 * Lays the take's pixels over the replay on a render page (render.html), in
 * the camera so they push in with it, under the hand, press rings and keys.
 * `show()` puts up the last frame the app painted by the replay's moment.
 */
export async function pixelLayer(page, take) {
  const shots = await extractPixels(take);
  if (!shots) return null;
  const t0 = await page.evaluate(() => {
    const { h, w } = window.renderInfo.viewport;
    const img = document.createElement("img");
    img.id = "wt-pixels";
    img.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;z-index:1;pointer-events:none`;
    const replay = document.querySelector(".wt-replay");
    // Its own stacking context, so the hand and the press rings stay above.
    replay.style.isolation = "isolate";
    replay.append(img);
    return window.WALKTHROUGH.events[0].timestamp;
  });
  let shown = -1;
  return {
    done: shots.done,
    async show() {
      const r = await page.evaluate(() => window.engine.state().r);
      const at = shots.indexAt(t0 + r);
      if (at === shown) return;
      shown = at;
      await page.evaluate(async (src) => {
        const img = document.getElementById("wt-pixels");
        img.src = src;
        await img.decode();
      }, pathToFileURL(shots.file(at)).href);
    },
  };
}
