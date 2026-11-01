import { FFMPEG_PATH, FFPROBE_PATH } from "@instrument-org/workspace/electron";
import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  planStoryboard,
  type Storyboard,
  StoryboardSchema,
} from "@/shared/video-storyboard";

import { createScopedLogger } from "./electron-logger";
import { pruneThumbnails } from "./file-thumbnails";

const log = createScopedLogger("VideoStoryboard");

/**
 * A video's storyboard (`shared/video-storyboard.ts`), made by the bundled
 * ffmpeg in a child process at the lowest priority, so playback in the
 * renderer and the app's own thread never wait on it.
 *
 * Made only when the player asks, which it does once the person points at
 * the video or it has played a while, never as it opens. One ffmpeg run
 * seeks to the middle of each step and decodes the frame there, from the
 * keyframe before it, and tiles the frames onto one JPEG: a long video costs
 * a keyframe's gap of decoding per frame rather than a decode of the whole.
 *
 * Kept on disk by the file's path and mtime, like the thumbnails, so a video
 * is done once; a video written since is a new name. One that gets none (too
 * short, no picture, no length, or ffmpeg failed) is remembered the same way.
 * One at a time; two players asking for one video share the run, and the run
 * stops when every player that asked for it has gone.
 */

/** Part of the key, so sheets made before a change to how they are made are made again. */
const MAKING = "2";
/** Longer than this, a run is stopped and the video gets none. */
const TIMEOUT_MS = 90_000;
const KEEP = {
  bytes: 128 * 1024 * 1024,
  count: 600,
  ms: 60 * 24 * 60 * 60 * 1000,
};

export interface StoryboardDeps {
  dir: string;
  ffmpeg: string;
  ffprobe: string;
}

/** Where storyboards are kept, beside the thumbnails, and the binaries that make them. */
export function videoStoryboardDeps(): StoryboardDeps {
  return {
    dir: path.join(app.getPath("userData"), "video-storyboards"),
    ffmpeg: FFMPEG_PATH,
    ffprobe: FFPROBE_PATH,
  };
}

/** The name a video's storyboard is kept under, from its path and mtime. */
export function storyboardKey(hostPath: string, modifiedAt: number) {
  return createHash("sha256")
    .update(`${hostPath}\0${modifiedAt}\0${MAKING}`)
    .digest("hex");
}

/** The kept sheet of a video as it is now, or null where none has been made. */
export async function storyboardSheet(hostPath: string, deps: StoryboardDeps) {
  const stats = await fs.stat(hostPath);
  const key = storyboardKey(hostPath, stats.mtimeMs);
  const bytes = await fs
    .readFile(path.join(deps.dir, `${key}.jpg`))
    .catch(() => null);
  return bytes && { bytes, modifiedAt: stats.mtimeMs };
}

interface Run {
  controller: AbortController;
  promise: Promise<null | Storyboard>;
  users: number;
}

const runs = new Map<string, Run>();
let queue: Promise<unknown> = Promise.resolve();
let made = 0;

/**
 * The video's storyboard, made now if it has none, or null where it gets
 * none. `signal` is the asker going away; the run stops once every asker has.
 */
export async function videoStoryboard(
  hostPath: string,
  deps: StoryboardDeps,
  signal?: AbortSignal,
): Promise<null | Storyboard> {
  const stats = await fs.stat(hostPath);
  if (!stats.isFile()) {
    return null;
  }
  const key = storyboardKey(hostPath, stats.mtimeMs);
  const kept = await readKept(deps.dir, key);
  if (kept !== undefined) {
    return kept;
  }
  let run = runs.get(key);
  // A run every asker left is on its way out; a new asker starts another.
  if (!run || run.controller.signal.aborted) {
    const controller = new AbortController();
    const started: Run = {
      controller,
      promise: Promise.resolve(null),
      users: 0,
    };
    // One at a time, in the order asked; a run whose askers have all gone
    // by its turn never starts.
    started.promise = queue
      .then(() =>
        controller.signal.aborted
          ? null
          : make(hostPath, stats.mtimeMs, key, deps, controller.signal),
      )
      .finally(() => {
        runs.delete(key);
      });
    queue = started.promise.catch(() => undefined);
    runs.set(key, started);
    run = started;
  }
  const shared = run;
  shared.users += 1;
  const leave = () => {
    shared.users -= 1;
    if (shared.users === 0) {
      log.info("Stopped a storyboard nobody is waiting for");
      shared.controller.abort();
    }
  };
  // An asker gone before it joined leaves at once.
  if (signal?.aborted) {
    leave();
  } else {
    signal?.addEventListener("abort", leave, { once: true });
  }
  try {
    return await shared.promise;
  } finally {
    if (!signal?.aborted) {
      signal?.removeEventListener("abort", leave);
      shared.users -= 1;
    }
  }
}

async function readKept(
  dir: string,
  key: string,
): Promise<null | Storyboard | undefined> {
  const text = await fs
    .readFile(path.join(dir, `${key}.json`), "utf8")
    .catch(() => undefined);
  if (text === undefined) {
    return undefined;
  }
  if (text === "") {
    return null;
  }
  const parsed = StoryboardSchema.safeParse(parseJson(text));
  // Pruned file by file, so a record can outlive its sheet; that video is
  // made again.
  const hasSheet = await fs.stat(path.join(dir, `${key}.jpg`)).then(
    () => true,
    () => false,
  );
  return parsed.success && hasSheet ? parsed.data : undefined;
}

async function make(
  hostPath: string,
  modifiedAt: number,
  key: string,
  deps: StoryboardDeps,
  signal: AbortSignal,
): Promise<null | Storyboard> {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  await fs.mkdir(deps.dir, { recursive: true });
  const marker = path.join(deps.dir, `${key}.json`);
  const probe = await runBinary(
    deps.ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      hostPath,
    ],
    stop,
  );
  if (signal.aborted) {
    return null;
  }
  const plan = probe.ok ? planStoryboard(probeShape(probe.stdout)) : null;
  if (!plan) {
    await fs.writeFile(marker, "");
    return null;
  }
  const sheet = path.join(deps.dir, `${key}.jpg`);
  const partial = path.join(deps.dir, `${key}.partial.jpg`);
  const started = performance.now();
  const result = await runBinary(
    deps.ffmpeg,
    sheetArgs(hostPath, plan, partial),
    stop,
  );
  if (signal.aborted) {
    await fs.rm(partial, { force: true });
    return null;
  }
  if (!result.ok) {
    log.warn(`No storyboard for a video: ${result.stderr.slice(0, 300)}`);
    await fs.rm(partial, { force: true });
    await fs.writeFile(marker, "");
    return null;
  }
  await fs.rename(partial, sheet);
  const storyboard: Storyboard = { ...plan, modifiedAt };
  await fs.writeFile(marker, JSON.stringify(storyboard));
  log.info(
    `Made a ${plan.count}-frame storyboard in ${Math.round(performance.now() - started)} ms`,
  );
  made += 1;
  if (made % 50 === 1) {
    void pruneThumbnails(deps.dir, KEEP);
  }
  return storyboard;
}

/**
 * ffmpeg's arguments for a sheet: an input per frame, each seeked to the
 * middle of its step (an exact seek, decoding from the keyframe before it),
 * its first frame scaled, and every frame tiled in order. Taking frames from
 * keyframes alone left a screen recording, whose keyframes can be many
 * seconds apart, with nothing past its last keyframe: black tiles.
 */
function sheetArgs(
  hostPath: string,
  plan: Omit<Storyboard, "modifiedAt">,
  out: string,
) {
  const steps = Array.from({ length: plan.count }, (_, index) =>
    ((index + 0.5) * plan.interval).toFixed(3),
  );
  const frames = steps.map(
    (_, index) =>
      `[${index}:v:0]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${plan.frameWidth}:${plan.frameHeight},setsar=1[f${index}]`,
  );
  const inputs = steps.map((_, index) => `[f${index}]`).join("");
  return [
    "-nostdin",
    "-v",
    "error",
    ...steps.flatMap((seconds) => ["-ss", seconds, "-i", hostPath]),
    "-filter_complex",
    `${frames.join(";")};${inputs}concat=n=${plan.count}:v=1:a=0,tile=${plan.columns}x${plan.rows}[sheet]`,
    "-map",
    "[sheet]",
    "-frames:v",
    "1",
    "-q:v",
    "6",
    "-y",
    out,
  ];
}

const ProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number().optional() }).optional(),
  streams: z
    .array(
      z.object({
        height: z.number().optional(),
        width: z.number().optional(),
      }),
    )
    .optional(),
});

/** ffprobe's answer as a length and a shape, NaN for what it did not say. */
function probeShape(stdout: string) {
  const parsed = ProbeSchema.safeParse(parseJson(stdout));
  const stream = parsed.data?.streams?.[0];
  return {
    duration: parsed.data?.format?.duration ?? Number.NaN,
    height: stream?.height ?? Number.NaN,
    width: stream?.width ?? Number.NaN,
  };
}

/**
 * Runs a binary to its end, at the lowest priority, killed when `signal`
 * goes; `ok` only for an exit of 0.
 */
export function runBinary(
  binary: string,
  args: string[],
  signal: AbortSignal,
): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, stderr: "", stdout: "" });
      return;
    }
    const child = spawn(binary, args, {
      // ffmpeg finishes the frame it is on when asked to stop, which on a
      // long file can be seconds; nothing it would write is wanted.
      killSignal: "SIGKILL",
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
      } catch {
        // Some systems refuse; the run goes on at the usual priority.
      }
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ ok: false, stderr: stderr || String(error), stdout });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stderr, stdout });
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
