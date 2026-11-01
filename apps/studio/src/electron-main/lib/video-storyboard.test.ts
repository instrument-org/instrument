import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "" } }));
vi.mock("@instrument-org/workspace/electron", () => ({
  FFMPEG_PATH: "ffmpeg",
  FFPROBE_PATH: "ffprobe",
}));
vi.mock("./file-thumbnails", () => ({ pruneThumbnails: vi.fn() }));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

const { storyboardKey, storyboardSheet, videoStoryboard } =
  await import("./video-storyboard");

const binaries = createRequire(import.meta.url)("ffmpeg-ffprobe-static") as {
  ffmpegPath: string;
  ffprobePath: string;
};

let root: string;
let video: string;
let short: string;
/** A screen recording's shape: one keyframe at the start and none after. */
let sparse: string;
/** An ffmpeg that writes a line per run to `runs.log`, then is ffmpeg. */
let countingFfmpeg: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-"));
  video = path.join(root, "clip.mp4");
  short = path.join(root, "short.mp4");
  sparse = path.join(root, "sparse.mp4");
  for (const [out, seconds, keyframeEvery] of [
    [video, 30, 10],
    [short, 5, 10],
    [sparse, 30, 1000],
  ] as const) {
    execFileSync(binaries.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x180:rate=10:duration=${seconds}`,
      "-c:v",
      "libx264",
      "-g",
      String(keyframeEvery),
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
  }
  countingFfmpeg = path.join(root, "ffmpeg.sh");
  await fs.writeFile(
    countingFfmpeg,
    `#!/bin/sh\necho run >> "${path.join(root, "runs.log")}"\nexec "${binaries.ffmpegPath}" "$@"\n`,
    { mode: 0o755 },
  );
});

afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function freshDeps(name: string) {
  const dir = path.join(root, name);
  await fs.rm(path.join(root, "runs.log"), { force: true });
  return { dir, ffmpeg: countingFfmpeg, ffprobe: binaries.ffprobePath };
}

async function runCount() {
  const log = await fs
    .readFile(path.join(root, "runs.log"), "utf8")
    .catch(() => "");
  return log.split("\n").filter(Boolean).length;
}

describe.skipIf(process.platform === "win32")("videoStoryboard", () => {
  it("makes one sheet for a video, then reads it from disk", async () => {
    const deps = await freshDeps("made");
    const made = await videoStoryboard(video, deps);
    expect(made).toMatchObject({
      columns: 10,
      count: 15,
      frameHeight: 90,
      frameWidth: 160,
      interval: 2,
      rows: 2,
    });
    const sheet = await storyboardSheet(video, deps);
    // A JPEG.
    expect(sheet?.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const size = execFileSync(binaries.ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path.join(
        deps.dir,
        `${storyboardKey(video, (await fs.stat(video)).mtimeMs)}.jpg`,
      ),
    ])
      .toString()
      .trim();
    expect(size).toBe("1600,180");

    expect(await videoStoryboard(video, deps)).toEqual(made);
    expect(await runCount()).toBe(1);
  });

  it("draws every frame of a video with one keyframe, the last included", async () => {
    const deps = await freshDeps("sparse");
    const made = await videoStoryboard(sparse, deps);
    expect(made?.count).toBe(15);
    const sheet = path.join(
      deps.dir,
      `${storyboardKey(sparse, (await fs.stat(sparse)).mtimeMs)}.jpg`,
    );
    // The test pattern is bright everywhere; a frame never drawn is black.
    const brightness = (column: number) =>
      Number(
        /YAVG=([\d.]+)/.exec(
          spawnSync(
            binaries.ffmpegPath,
            [
              "-v",
              "info",
              "-i",
              sheet,
              "-vf",
              `crop=160:90:${column * 160}:90,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
              "-f",
              "null",
              "-",
            ],
            { encoding: "utf8" },
          ).stderr,
        )?.[1],
      );
    // The last frame, at 29s, is the second row's fifth tile.
    expect(brightness(4)).toBeGreaterThan(30);
  });

  it("shares one run between two askers", async () => {
    const deps = await freshDeps("shared");
    const [first, second] = await Promise.all([
      videoStoryboard(video, deps),
      videoStoryboard(video, deps),
    ]);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(await runCount()).toBe(1);
  });

  it("gives a video too short for one none, and remembers it", async () => {
    const deps = await freshDeps("short");
    expect(await videoStoryboard(short, deps)).toBeNull();
    expect(await videoStoryboard(short, deps)).toBeNull();
    // Probed once, and ffmpeg never ran.
    expect(await runCount()).toBe(0);
    expect(await storyboardSheet(short, deps)).toBeNull();
  });

  it("stops when its only asker goes, and keeps nothing", async () => {
    const deps = await freshDeps("canceled");
    const controller = new AbortController();
    const asked = videoStoryboard(video, deps, controller.signal);
    controller.abort();
    expect(await asked).toBeNull();
    expect(await storyboardSheet(video, deps)).toBeNull();
    const left = await fs.readdir(deps.dir).catch(() => []);
    expect(left).toEqual([]);

    // Asked again, it is made.
    expect(await videoStoryboard(video, deps)).not.toBeNull();
  });

  it("kills a run under way when its only asker goes", async () => {
    const deps = await freshDeps("killed");
    // An ffmpeg that takes its time, so the run is under way when it is left.
    const slow = path.join(root, "slow-ffmpeg.sh");
    await fs.writeFile(
      slow,
      `#!/bin/sh\necho run >> "${path.join(root, "runs.log")}"\nexec sleep 30\n`,
      { mode: 0o755 },
    );
    const controller = new AbortController();
    const started = Date.now();
    const asked = videoStoryboard(
      video,
      { ...deps, ffmpeg: slow },
      controller.signal,
    );
    await vi.waitFor(async () => {
      expect(await runCount()).toBe(1);
    });
    controller.abort();
    expect(await asked).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await fs.readdir(deps.dir)).toEqual([]);
  });

  it("goes on for an asker who stays when another goes", async () => {
    const deps = await freshDeps("one-stays");
    const controller = new AbortController();
    const leaving = videoStoryboard(video, deps, controller.signal);
    const staying = videoStoryboard(video, deps);
    controller.abort();
    expect(await staying).not.toBeNull();
    await leaving;
    expect(await runCount()).toBe(1);
  });

  it("is a new sheet once the video is written again", async () => {
    const deps = await freshDeps("rewritten");
    const copy = path.join(root, "copy.mp4");
    await fs.copyFile(video, copy);
    await videoStoryboard(copy, deps);
    const later = new Date(Date.now() + 5000);
    await fs.utimes(copy, later, later);
    const again = await videoStoryboard(copy, deps);
    expect(again?.modifiedAt).toBe((await fs.stat(copy)).mtimeMs);
    expect(await runCount()).toBe(2);
  });
});
