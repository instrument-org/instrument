import { execa } from "execa";
import { imageSize } from "image-size";

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
 * An image's dimensions as a viewer displays them.
 *
 * A JPEG carrying an EXIF orientation of 5-8 stores its pixels rotated a
 * quarter turn from how it is meant to be seen, so its stored width is its
 * displayed height. Everything downstream -- the size we tell the model, the
 * coordinates it sends back -- has to be in displayed terms, because displayed
 * is what it sees.
 */
export function measureImage(bytes: Buffer): ImageSize | undefined {
  try {
    const { height, orientation, width } = imageSize(bytes);
    const quarterTurned = orientation !== undefined && orientation >= 5;
    return quarterTurned ? { height: width, width: height } : { height, width };
  } catch {
    return undefined;
  }
}

async function runFfmpeg({
  bytes,
  region,
  signal,
  target,
  ...encoding
}: {
  bytes: Buffer;
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

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", "pipe:0"];
  if (toJpeg) {
    // JPEG has no alpha. Without a backdrop a transparent PNG flattens to
    // black, which is a common way for a chart on a clear background to come
    // back unreadable; compositing onto white matches how a viewer shows it.
    args.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=white:s=${target.width}x${target.height}`,
    );
    args.push(
      "-filter_complex",
      `[0:v]${steps.join(",")}[fg];[1:v][fg]overlay=format=auto`,
    );
  } else {
    args.push("-vf", steps.join(","));
  }
  args.push("-frames:v", "1", "-f", "image2");
  args.push(
    ...(toJpeg
      ? [
          "-c:v",
          "mjpeg",
          "-pix_fmt",
          pixelFormat ?? "yuvj444p",
          "-q:v",
          String(quality ?? 2),
        ]
      : ["-c:v", "png"]),
  );
  args.push("pipe:1");

  const result = await execa(FFMPEG_PATH, args, {
    cancelSignal: signal,
    encoding: "buffer",
    input: bytes,
    reject: false,
  });

  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return undefined;
  }
  return Buffer.from(result.stdout);
}

/**
 * Re-render an image (optionally cropping first) at a target size, encoded
 * small enough to send.
 *
 * PNG comes first and usually wins: these are screenshots, charts, and
 * documents, where lossy artifacts land on exactly the small text the caller
 * wants read. JPEG is the fallback for when PNG will not fit, and shrinking is
 * the fallback for when no quality setting will. Returns undefined only when
 * every step failed, which leaves the caller holding the original.
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
}): Promise<RenderedImage | undefined> {
  let attempt = target;

  for (let step = 0; step < SHRINK_STEPS; step++) {
    const candidates = [
      { toJpeg: false },
      ...JPEG_STEPS.map((jpeg) => ({ ...jpeg, toJpeg: true })),
    ];

    for (const candidate of candidates) {
      const rendered = await runFfmpeg({
        ...candidate,
        bytes,
        region,
        signal,
        target: attempt,
      });
      if (rendered && rendered.byteLength <= maxBytes) {
        return {
          bytes: rendered,
          height: attempt.height,
          mediaType: candidate.toJpeg ? "image/jpeg" : "image/png",
          width: attempt.width,
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

  return undefined;
}
