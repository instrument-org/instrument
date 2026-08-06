import { execa } from "execa";
import { imageSize } from "image-size";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FFMPEG_PATH } from "./ffmpeg";
import { type ImageSize } from "./image-view-size";

export interface ImageRegion {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface RenderedImage {
  bytes: Buffer;
  height: number;
  mediaType: string;
  width: number;
}

/**
 * What came back, and when nothing did, whose fault it was.
 *
 * `failed` is the image: ffmpeg read it and could not produce anything inside
 * the budget. `unavailable` is us: ffmpeg never ran, so nothing is known about
 * the image at all. Callers owe those two different answers -- there is no
 * point telling someone to convert a file that is fine.
 */
export type RenderImageResult =
  | { image: RenderedImage; state: "rendered" }
  | { state: "failed" }
  | { state: "unavailable" };

// Descending quality, tried in order once PNG proves too large. The first two
// keep full chroma resolution: 4:2:0 subsampling halves color detail, which
// smears the hairline chart rules and 1px UI borders this pipeline exists to
// keep legible. Below that the file size matters more than the smearing.
const JPEG_STEPS = [
  { pixelFormat: "yuvj444p", quality: 2 },
  { pixelFormat: "yuvj444p", quality: 5 },
  { pixelFormat: "yuvj420p", quality: 8 },
  { pixelFormat: "yuvj420p", quality: 14 },
] as const;

const SHRINK_STEPS = 6;
const SHRINK_FACTOR = 0.75;

/**
 * Ceiling on the pixels a decoder will be asked to hold.
 *
 * A file's size on disk does not bound this. Compression ratio is unbounded for
 * synthetic images -- a PNG of one flat color is a few hundred bytes at any
 * dimensions it likes -- so a small file can declare a size that costs gigabytes
 * the moment something decodes it. Dimensions come from the header, so the
 * refusal happens before any decode rather than during one.
 *
 * Set to admit a large scan and refuse the absurd: a 12000x12000 archival scan
 * is 144M pixels and passes.
 */
export const MAX_DECODED_PIXELS = 200_000_000;

// image-size's format names, mapped to the media types a provider is told.
// Anything it can identify but that is missing here still reads as an image;
// it just has to be re-encoded before it can be sent.
const SNIFFED_MEDIA_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Whether decoding an image of this size would cost more memory than we allow. */
export function exceedsDecodeBudget({ height, width }: ImageSize) {
  return width * height > MAX_DECODED_PIXELS;
}

/**
 * What an image actually is, read from its bytes.
 *
 * The bytes are the only honest source. A file's extension is a claim its
 * contents do not have to honor -- a download served as PNG under a `.jpg`
 * name, a truncated write, an error page saved where an image was expected --
 * and a media type taken from the name is how a request gets rejected for
 * contradicting itself.
 *
 * Dimensions come back as a viewer displays them. A JPEG carrying an EXIF
 * orientation of 5-8 stores its pixels a quarter turn from how it is meant to
 * be seen, so its stored width is its displayed height, and displayed is what
 * the model's coordinates refer to.
 *
 * `format` is what the bytes were identified as, which is worth naming in a
 * message even for the formats `mediaType` has no entry for.
 *
 * `undefined` means these bytes could not be identified as an image at all.
 */
export function measureImage(
  bytes: Buffer,
): (ImageSize & { format?: string; mediaType?: string }) | undefined {
  try {
    const { height, orientation, type, width } = imageSize(bytes);
    const quarterTurned = orientation !== undefined && orientation >= 5;
    const size = quarterTurned
      ? { format: type, height: width, width: height }
      : { format: type, height, width };
    const mediaType =
      type === undefined ? undefined : SNIFFED_MEDIA_TYPES[type];
    return mediaType === undefined ? size : { ...size, mediaType };
  } catch {
    return undefined;
  }
}

/**
 * Re-render an image (optionally cropping first) at a target size, encoded
 * small enough to send.
 *
 * PNG comes first and usually wins: these are screenshots, charts, and
 * documents, where lossy artifacts land on exactly the small text the caller
 * wants read. JPEG is the fallback for when PNG will not fit, and shrinking is
 * the fallback for when no quality setting will.
 *
 * Refuses without trying when the source declares more pixels than
 * `MAX_DECODED_PIXELS`. That check lives here because this is the only place
 * that starts a decode: callers test it too, so they can name the cause in a
 * message, but the enforcement cannot depend on them remembering to.
 *
 * The bytes are staged as a file rather than piped in. Some containers keep the
 * index that describes them at the end of the file, so reading one means
 * seeking backwards -- which a pipe cannot do. HEIC is the format that makes
 * this concrete: the same photo ffmpeg decodes from disk fails on stdin with
 * "Not yet implemented in FFmpeg, patches welcome". `canDecodeMedia` probes a
 * path for the same reason.
 */
export async function renderImage({
  bytes,
  maxBytes,
  region,
  signal,
  target,
}: {
  bytes: Buffer;
  maxBytes: number;
  region?: ImageRegion;
  signal?: AbortSignal;
  target: ImageSize;
}): Promise<RenderImageResult> {
  // Measured here rather than taken as an argument: a size a caller passes is a
  // size a caller can get wrong, and this has to hold for every caller there
  // will ever be. An unmeasurable source is left to ffmpeg, which is the only
  // thing that can read some of the formats image-size cannot.
  const source = measureImage(bytes);
  if (source && exceedsDecodeBudget(source)) {
    return { state: "failed" };
  }

  // Written once and read by every attempt below, since all thirty of them
  // decode the same bytes.
  const staged = await stageInput(bytes);
  if (!staged) {
    return { state: "unavailable" };
  }

  try {
    let attempt = target;

    for (let step = 0; step < SHRINK_STEPS; step++) {
      const candidates = [
        { toJpeg: false },
        ...JPEG_STEPS.map((jpeg) => ({ ...jpeg, toJpeg: true })),
      ];

      for (const candidate of candidates) {
        const rendered = await runFfmpeg({
          ...candidate,
          inputPath: staged.file,
          region,
          signal,
          target: attempt,
        });
        if (rendered === "unavailable") {
          // Every remaining step is the same spawn with different arguments, so
          // one that never started settles all thirty of them.
          return { state: "unavailable" };
        }
        if (rendered && rendered.byteLength <= maxBytes) {
          return {
            image: {
              bytes: rendered,
              height: attempt.height,
              mediaType: candidate.toJpeg ? "image/jpeg" : "image/png",
              width: attempt.width,
            },
            state: "rendered",
          };
        }
      }

      attempt = {
        height: Math.max(1, Math.floor(attempt.height * SHRINK_FACTOR)),
        width: Math.max(1, Math.floor(attempt.width * SHRINK_FACTOR)),
      };
      if (attempt.width === 1 && attempt.height === 1) {
        break;
      }
    }

    return { state: "failed" };
  } finally {
    await fs.rm(staged.dir, { force: true, recursive: true });
  }
}

async function runFfmpeg({
  inputPath,
  region,
  signal,
  target,
  ...encoding
}: {
  inputPath: string;
  pixelFormat?: string;
  quality?: number;
  region?: ImageRegion;
  signal?: AbortSignal;
  target: ImageSize;
  toJpeg: boolean;
}) {
  const { pixelFormat, quality, toJpeg } = encoding;
  const steps = [
    // ffmpeg applies EXIF orientation as it decodes, so every filter below sees
    // the image the way a viewer would, and a region's coordinates mean the
    // same thing here as they do to the model.
    ...(region
      ? [`crop=${region.width}:${region.height}:${region.left}:${region.top}`]
      : []),
    `scale=${target.width}:${target.height}:flags=lanczos`,
  ];

  // JPEG has no alpha. Without a backdrop a transparent PNG flattens to black,
  // which is a common way for a chart on a clear background to come back
  // unreadable; compositing onto white matches how a viewer shows it.
  const filtering = toJpeg
    ? [
        "-f",
        "lavfi",
        "-i",
        `color=c=white:s=${target.width}x${target.height}`,
        "-filter_complex",
        `[0:v]${steps.join(",")}[fg];[1:v][fg]overlay=format=auto`,
      ]
    : ["-vf", steps.join(",")];

  const encoder = toJpeg
    ? [
        "-c:v",
        "mjpeg",
        "-pix_fmt",
        pixelFormat ?? "yuvj444p",
        "-q:v",
        String(quality ?? 2),
      ]
    : ["-c:v", "png"];

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    ...filtering,
    "-frames:v",
    "1",
    "-f",
    "image2",
    ...encoder,
    "pipe:1",
  ];

  const result = await execa(FFMPEG_PATH, args, {
    cancelSignal: signal,
    encoding: "buffer",
    // Nothing arrives on stdin now that the input is a file, and ffmpeg reads
    // whatever is there as interactive keystrokes -- a `q` among them aborts
    // the encode midway.
    reject: false,
    stdin: "ignore",
  });

  // No exit code means the process never reached one: it failed to spawn, or a
  // signal took it down. The binary is bundled, so the first is rare -- but it
  // is a machine where nothing here will ever work, and it must not be read as
  // a verdict on the image.
  if (result.exitCode === undefined) {
    return "unavailable";
  }
  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return;
  }
  return Buffer.from(result.stdout);
}

/**
 * Put the bytes somewhere ffmpeg can seek around in.
 *
 * `undefined` when the file could not be written, which is a fact about the
 * machine rather than the image and reaches the caller as `unavailable`: no
 * decode was attempted, so nothing was learned about these bytes. The name
 * carries no extension on purpose -- ffmpeg identifies a container by reading
 * it, and a name that guessed wrong could only mislead.
 */
async function stageInput(bytes: Buffer) {
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "instrument-render-"));
    const file = path.join(dir, "source");
    await fs.writeFile(file, bytes);
    return { dir, file };
  } catch {
    return;
  }
}
