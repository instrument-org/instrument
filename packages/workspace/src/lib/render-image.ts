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
 * `undefined` means these bytes could not be identified as an image at all.
 */
export function measureImage(
  bytes: Buffer,
): (ImageSize & { mediaType?: string }) | undefined {
  try {
    const { height, orientation, type, width } = imageSize(bytes);
    const quarterTurned = orientation !== undefined && orientation >= 5;
    const size = quarterTurned
      ? { height: width, width: height }
      : { height, width };
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
 * Returns undefined when every step failed, and without trying when the source
 * declares more pixels than `MAX_DECODED_PIXELS`. That check lives here because
 * this is the only place that starts a decode: callers test it too, so they can
 * name the cause in a message, but the enforcement cannot depend on them
 * remembering to.
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
  // Measured here rather than taken as an argument: a size a caller passes is a
  // size a caller can get wrong, and this has to hold for every caller there
  // will ever be. An unmeasurable source is left to ffmpeg, which is the only
  // thing that can read some of the formats image-size cannot.
  const source = measureImage(bytes);
  if (source && exceedsDecodeBudget(source)) {
    return undefined;
  }

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
    "pipe:0",
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
    input: bytes,
    reject: false,
  });

  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return;
  }
  return Buffer.from(result.stdout);
}
