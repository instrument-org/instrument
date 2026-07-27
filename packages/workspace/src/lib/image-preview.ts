import { ok } from "neverthrow";
import { z } from "zod";

import { executeError } from "./execute-error";
import {
  type ImageSize,
  type ImageViewLimits,
  imageViewSize,
} from "./image-view-size";
import { measureImage, renderImage } from "./render-image";

// Multiplier that pushes a crop's size past any budget, so imageViewSize comes
// back down to the largest in-budget size instead of leaving it as-is.
const MAGNIFY_PROBE = 10_000;

// Providers cap a single image near 5 MB encoded; base64 adds a third.
const MAX_RENDERED_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);

// Some models support more formats, but this should be safe across most.
export const SUPPORTED_IMAGE_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const RegionSchema = z.object({
  x1: z.number().int().meta({ description: "Left edge, in pixels" }),
  x2: z.number().int().meta({ description: "Right edge, in pixels" }),
  y1: z.number().int().meta({ description: "Top edge, in pixels" }),
  y2: z.number().int().meta({ description: "Bottom edge, in pixels" }),
});

export type RegionInput = z.output<typeof RegionSchema>;

/**
 * Crop a region out of the full-resolution file and hand it back magnified.
 *
 * Two things make this readable where the full view was not. The crop comes
 * from the file on disk, so it uses every pixel the image has rather than the
 * ones that survived the downscale the model was shown. And it is scaled up to
 * fill the whole image budget, so what was a handful of pixels gets spread over
 * as many of the provider's patches as the region's shape allows.
 */
export async function cropRegion({
  fileData,
  limits,
  region,
  signal,
  size,
  view,
}: {
  fileData: Buffer;
  limits: ImageViewLimits;
  region: RegionInput;
  signal: AbortSignal;
  size: ImageSize;
  view: ImageSize;
}) {
  const left = clamp(Math.min(region.x1, region.x2), 0, view.width);
  const right = clamp(Math.max(region.x1, region.x2), 0, view.width);
  const top = clamp(Math.min(region.y1, region.y2), 0, view.height);
  const bottom = clamp(Math.max(region.y1, region.y2), 0, view.height);

  if (right - left < 1 || bottom - top < 1) {
    return executeError(
      [
        `Region (${region.x1},${region.y1})-(${region.x2},${region.y2}) is empty`,
        `or outside the ${view.width}x${view.height} image.`,
        "Give two corners in that pixel space, with the origin at the top-left.",
      ].join(" "),
    );
  }

  // Both corners are mapped, each on its own axis, rather than mapping the
  // origin and scaling the extent. The view's height is a rounded value, so its
  // aspect ratio is not exactly the original's and one shared factor drifts
  // vertically. Deriving the extent from two clamped corners also keeps
  // `left + width` inside the source, which rounding them apart does not: a
  // region touching the right or bottom edge could ask ffmpeg to crop one pixel
  // past the image and fail the render instead of landing on the edge.
  const scaleX = size.width / view.width;
  const scaleY = size.height / view.height;
  const sourceLeft = clamp(Math.round(left * scaleX), 0, size.width - 1);
  const sourceTop = clamp(Math.round(top * scaleY), 0, size.height - 1);
  const source = {
    height:
      clamp(Math.round(bottom * scaleY), sourceTop + 1, size.height) -
      sourceTop,
    left: sourceLeft,
    top: sourceTop,
    width:
      clamp(Math.round(right * scaleX), sourceLeft + 1, size.width) -
      sourceLeft,
  };

  // Ask for a size far past the budget so the search comes back down to the
  // largest one that fits, which is the most magnification this shape allows.
  const target = imageViewSize({
    height: source.height * MAGNIFY_PROBE,
    limits,
    width: source.width * MAGNIFY_PROBE,
  });

  const rendered = await renderImage({
    bytes: fileData,
    maxBytes: MAX_RENDERED_BYTES,
    region: source,
    signal,
    target,
  });

  if (!rendered) {
    return executeError(
      "Could not render that region of the image. Try a larger region.",
    );
  }

  return ok({ region: { x1: left, x2: right, y1: top, y2: bottom }, rendered });
}

/**
 * Name the pixel space the model is looking at.
 *
 * Without this the model sees a picture and no idea how big it is, so any
 * position it reasons about is a guess at a scale it was never told. When the
 * file is larger than the provider renders, both numbers matter: the file's
 * because that is what still exists on disk, and the view's because that is
 * what the model's eyes are actually on.
 */
export function describeImageSize(output: {
  height?: number;
  region?: RegionInput;
  renderedHeight?: number;
  renderedWidth?: number;
  viewHeight?: number;
  viewWidth?: number;
  width?: number;
}) {
  const {
    height,
    region,
    renderedHeight,
    renderedWidth,
    viewHeight,
    viewWidth,
    width,
  } = output;
  if (width === undefined || height === undefined) {
    return "";
  }
  const downscaled =
    viewWidth !== undefined &&
    viewHeight !== undefined &&
    (viewWidth !== width || viewHeight !== height);

  if (
    region &&
    downscaled &&
    renderedWidth !== undefined &&
    renderedHeight !== undefined
  ) {
    return [
      ` -- region (${region.x1},${region.y1})-(${region.x2},${region.y2})`,
      ` of the ${viewWidth}x${viewHeight} view,`,
      ` cropped from the ${width}x${height} original`,
      ` and magnified to ${renderedWidth}x${renderedHeight}`,
    ].join("");
  }

  if (region && renderedWidth !== undefined && renderedHeight !== undefined) {
    return [
      ` -- region (${region.x1},${region.y1})-(${region.x2},${region.y2})`,
      ` of the ${width}x${height} image,`,
      ` magnified to ${renderedWidth}x${renderedHeight}`,
    ].join("");
  }

  const detailNote = downscaled
    ? ". Small text and closely spaced lines may not survive at that size; read it again with a `region` to magnify part of it"
    : "";

  return downscaled
    ? ` (${width}x${height} px, shown to you at ${viewWidth}x${viewHeight})${detailNote}`
    : ` (${width}x${height} px)`;
}

// SVG is markup, so it reads as text rather than as pixels.
export function isReadableImage(mimeType: string) {
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
}

/**
 * The bytes the model is shown, and the size those bytes actually are.
 *
 * `view` is measured from what came back, never assumed from what was asked for,
 * because the whole coordinate contract rests on the announced pixel space
 * matching the pixels sent.
 *
 * An image already inside the budget is passed through byte for byte. That is
 * worth keeping deliberately: re-encoding it would soften exactly the hairlines
 * and small text a region read exists to make legible, and there is nothing to
 * gain when the file is already the size the model will see.
 */
export async function previewImage({
  fileData,
  signal,
  size,
  target,
}: {
  fileData: Buffer;
  signal: AbortSignal;
  size: ImageSize & { mediaType?: string };
  target: ImageSize;
}) {
  const { mediaType } = size;
  const withinBudget =
    target.width === size.width && target.height === size.height;

  if (
    mediaType !== undefined &&
    SUPPORTED_IMAGE_FORMATS.includes(mediaType) &&
    withinBudget &&
    fileData.byteLength <= MAX_RENDERED_BYTES
  ) {
    return ok({
      bytes: fileData,
      mediaType,
      view: { height: size.height, width: size.width },
    });
  }

  const rendered = await renderImage({
    bytes: fileData,
    maxBytes: MAX_RENDERED_BYTES,
    signal,
    target,
  });

  if (!rendered) {
    return executeError(
      [
        "Could not produce a viewable copy of this image.",
        "Convert it to PNG or JPEG, or downscale it, and read the result.",
      ].join(" "),
    );
  }

  // Read back off the encoded result rather than trusting the size it was asked
  // for. Same principle as the rest of this function, applied one level down.
  const measured = measureImage(rendered.bytes);

  return ok({
    bytes: rendered.bytes,
    mediaType: rendered.mediaType,
    view: {
      height: measured?.height ?? rendered.height,
      width: measured?.width ?? rendered.width,
    },
  });
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}
