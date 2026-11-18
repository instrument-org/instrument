// Renders a built take to an MP4, one frame at a time: the player is sought
// to each frame's time and captured, so the cursor, camera and captions land
// on exact frames however long a frame takes to draw. Frames are drawn at
// twice the pixels and scaled down, so text stays sharp at 1080p. A GIF, for
// an email or a changelog, is made from the MP4.
//
// `clip` is a feature clip for What's new: the app alone with no frame
// around it, the camera on, no captions, keys large across the middle, cut
// to 3:2 at 1200x800, with a poster from its last frame. It is checked as it
// is written (check.mjs), and the check's FAIL lines come back with it.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { launch, sizedPage } from "./browser.mjs";
import { checkClip } from "./check.mjs";

export async function renderClip(
  take,
  { chapter, clip = false, fps = 30, gif = false, out, plain = false } = {},
) {
  const name = chapter ? `chapter-${chapter}` : "walkthrough";
  const suffix = clip ? "-clip" : plain ? "-plain" : "";
  const file = out ?? path.join(take, "video", `${name}${suffix}.mp4`);
  mkdirSync(path.dirname(file), { recursive: true });
  const { viewport } = JSON.parse(readFileSync(path.join(take, "walkthrough.json"), "utf8"));

  const browser = await launch();
  const { capture, page } = await sizedPage(browser, {
    height: clip ? viewport.h : 1080,
    scale: 2,
    width: clip ? viewport.w : 1920,
  });
  const query = new URLSearchParams({
    ...(chapter && { chapter: String(chapter) }),
    ...(plain && { camera: "0", captions: "0" }),
    ...(clip && { bare: "1", captions: "0", keys: "center" }),
  });
  await page.goto(`file://${path.join(take, "render.html")}?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.renderInfo);
  await page.waitForTimeout(500);
  const { actions, appZoom, length } = await page.evaluate(() => window.renderInfo);
  // A beat held on the first and last frames, as a film starts and ends. A
  // clip starts on its action and holds its result a little less.
  const lead = clip ? 0 : 400;
  const tail = clip ? 900 : 1200;
  const frames = Math.ceil(((length + lead + tail) / 1000) * fps);

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-vf", clip
        ? "crop='min(iw,ih*3/2)':'min(ih,iw*2/3)',scale=1200:800:flags=lanczos"
        : "scale=1920:1080:flags=lanczos",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
      "-movflags", "+faststart", file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  let exited = null;
  ffmpeg.on("close", (code) => {
    exited = code;
  });
  const started = Date.now();
  const scales = [];
  for (let i = 0; i < frames; i++) {
    const p = Math.min(length, Math.max(0, (i * 1000) / fps - lead));
    scales.push(await page.evaluate(async (at) => {
      await window.renderAt(at);
      return window.engine.camera().s;
    }, p));
    const jpeg = await capture(null, { format: "jpeg", quality: 92 });
    if (exited !== null) throw new Error(`ffmpeg exited (${exited}) at frame ${i}`);
    if (!ffmpeg.stdin.write(jpeg)) {
      await new Promise((r) => ffmpeg.stdin.once("drain", r));
    }
  }
  ffmpeg.stdin.end();
  if (exited === null) await new Promise((r) => ffmpeg.on("close", r));
  await browser.close();

  const result = { file, frames, renderSeconds: Math.round((Date.now() - started) / 1000), seconds: frames / fps };
  if (clip) {
    const poster = file.replace(/\.mp4$/, ".jpg");
    await new Promise((resolve, reject) => {
      const job = spawn("ffmpeg", ["-y", "-loglevel", "error", "-sseof", "-0.2", "-i", file, "-frames:v", "1", "-q:v", "3", poster], { stdio: "inherit" });
      job.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg poster exited ${code}`))));
    });
    // What the check needs again later, without rendering again.
    const info = { actions: actions.map((a) => ({ ...a, p: a.p + lead })), appZoom, fps, scales, viewportWidth: viewport.w };
    writeFileSync(file.replace(/\.mp4$/, ".json"), JSON.stringify(info));
    Object.assign(result, { poster }, await checkClip(file, { ...info, strip: file.replace(/\.mp4$/, "-strip.png") }));
  }
  if (gif) {
    // 960 wide at 15 frames a second, on one palette made for the clip.
    const gifFile = file.replace(/\.mp4$/, ".gif");
    await new Promise((resolve, reject) => {
      const job = spawn(
        "ffmpeg",
        [
          "-y", "-loglevel", "error", "-i", file,
          "-vf", "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
          gifFile,
        ],
        { stdio: "inherit" },
      );
      job.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg gif exited ${code}`))));
    });
    result.gif = gifFile;
  }
  return result;
}
