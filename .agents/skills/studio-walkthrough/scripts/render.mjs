// Renders a built take to an MP4, one frame at a time: the player is sought
// to each frame's time and captured, so the cursor, camera and captions land
// on exact frames however long a frame takes to draw. Frames are drawn at
// twice the pixels and scaled down, so text stays sharp at 1080p. A GIF, for
// an email or a changelog, is made from the MP4.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { launch, sizedPage } from "./browser.mjs";

export async function renderClip(
  take,
  { chapter, fps = 30, gif = false, out, plain = false } = {},
) {
  const name = chapter ? `chapter-${chapter}` : "walkthrough";
  const file = out ?? path.join(take, "video", `${name}${plain ? "-plain" : ""}.mp4`);
  mkdirSync(path.dirname(file), { recursive: true });

  const browser = await launch();
  const { capture, page } = await sizedPage(browser, {
    height: 1080,
    scale: 2,
    width: 1920,
  });
  const query = new URLSearchParams({
    ...(chapter && { chapter: String(chapter) }),
    ...(plain && { camera: "0", captions: "0" }),
  });
  await page.goto(`file://${path.join(take, "render.html")}?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.renderInfo);
  await page.waitForTimeout(500);
  const { length } = await page.evaluate(() => window.renderInfo);
  // A beat held on the first and last frames, as a film starts and ends.
  const lead = 400;
  const tail = 1200;
  const frames = Math.ceil(((length + lead + tail) / 1000) * fps);

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-vf", "scale=1920:1080:flags=lanczos",
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
  for (let i = 0; i < frames; i++) {
    const p = Math.min(length, Math.max(0, (i * 1000) / fps - lead));
    await page.evaluate((at) => window.renderAt(at), p);
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
