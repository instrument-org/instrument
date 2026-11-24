import type { Protocol } from "devtools-protocol";

import { MAX_SCREENSHOT_PIXELS } from "@instrument-org/workspace/electron";

/** An image's pixels, four bytes each, rows from the top. */
export interface Bitmap {
  data: Buffer;
  height: number;
  width: number;
}

/** Turns a PNG into its pixels and pixels into the format a capture asked for. */
export interface ImageCodec {
  decode: (png: Buffer) => Bitmap;
  encode: (
    bitmap: Bitmap,
    format: Protocol.Page.CaptureScreenshotRequest["format"],
    quality: number | undefined,
  ) => Buffer;
}

type Clip = Protocol.Page.Viewport;

/**
 * One capture of a clip cut into several: what to capture, and how much of
 * its left and top, in the clip's units, an earlier piece already holds.
 */
export interface Piece {
  clip: Clip;
  skip: { x: number; y: number };
}

/** The whole document as a clip, for a capture beyond the viewport that names none. */
export function documentClip({ height, width, x, y }: Protocol.DOM.Rect): Clip {
  return { height, scale: 1, width, x, y };
}

/**
 * A clip cut down, on a side that would come out larger than `maxPixels`, to
 * just over what fills them, keeping its top left corner; the image is then
 * cut to `maxPixels` exactly. `pixelsPerUnit` is how many pixels of the image
 * one unit of the clip came out as, each way.
 */
export function cappedClip(
  clip: Clip,
  pixelsPerUnit: { x: number; y: number },
  maxPixels: number,
): Clip {
  return {
    ...clip,
    height: Math.min(clip.height, Math.ceil(maxPixels / pixelsPerUnit.y) + 1),
    width: Math.min(clip.width, Math.ceil(maxPixels / pixelsPerUnit.x) + 1),
  };
}

/**
 * A clip cut into rows of pieces no larger than the viewport, left to right
 * and top down. A clip the viewport has room for is its own one piece.
 *
 * Every piece is the same size: the last of a row or a column reaches back
 * over the one before it rather than being smaller, and says how much of it
 * to skip. The guest returns a capture exactly the viewport's size in the
 * display's color space and says so, and a smaller one in the same space
 * without saying so, so pieces of two sizes come back as two different
 * colors for the same pixel.
 */
export function viewportPiecesOf(
  clip: Clip,
  viewport: Pick<Protocol.Page.LayoutViewport, "clientHeight" | "clientWidth">,
): Piece[][] {
  const width = Math.min(
    clip.width,
    Math.max(1, Math.floor(viewport.clientWidth / clip.scale)),
  );
  const height = Math.min(
    clip.height,
    Math.max(1, Math.floor(viewport.clientHeight / clip.scale)),
  );
  const rows: Piece[][] = [];
  for (let top = 0; top < clip.height; top += height) {
    const y = Math.min(top, clip.height - height);
    const row: Piece[] = [];
    for (let left = 0; left < clip.width; left += width) {
      const x = Math.min(left, clip.width - width);
      row.push({
        clip: {
          height,
          scale: clip.scale,
          width,
          x: clip.x + x,
          y: clip.y + y,
        },
        skip: { x: left - x, y: top - y },
      });
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Copies a piece into an image at a place in it, from `skip` pixels in from
 * the piece's left and top, leaving out what falls outside the image.
 * Answers how many pixels of the piece it had to place, each way.
 */
export function drawPiece(
  image: Bitmap,
  piece: Bitmap,
  {
    left,
    skip,
    top,
  }: { left: number; skip: { x: number; y: number }; top: number },
) {
  const size = {
    height: Math.max(0, piece.height - skip.y),
    width: Math.max(0, piece.width - skip.x),
  };
  const pixels = Math.min(size.width, image.width - left);
  const lines = Math.min(size.height, image.height - top);
  if (pixels <= 0) {
    return size;
  }
  for (let line = 0; line < lines; line++) {
    const from = ((skip.y + line) * piece.width + skip.x) * 4;
    piece.data.copy(
      image.data,
      ((top + line) * image.width + left) * 4,
      from,
      from + pixels * 4,
    );
  }
  return size;
}

/**
 * Captures a clip that lies anywhere in the document, an element or the
 * whole page, without scrolling it. A `<webview>` guest draws a clip beyond
 * the viewport correctly only up to the viewport's own size, and past that
 * repeats the first viewport's worth, so a larger clip is taken a viewport
 * at a time and each piece copied into one image as it arrives. The guest
 * lays the page out once, at the scroll position it is at, and each capture
 * moves only what is drawn, so an element fixed to the viewport is in the
 * image once, where that scroll position puts it.
 *
 * The image is at most `maxPixels` on either side: a clip that would come
 * out larger is cut there, from its top left corner.
 */
export async function captureClip({
  codec,
  maxPixels = MAX_SCREENSHOT_PIXELS,
  request,
  send,
  viewport,
}: {
  codec: ImageCodec;
  maxPixels?: number;
  request: Protocol.Page.CaptureScreenshotRequest & { clip: Clip };
  /** Sends one capture to the guest's debugger. */
  send: (request: Protocol.Page.CaptureScreenshotRequest) => Promise<unknown>;
  viewport: Pick<Protocol.Page.LayoutViewport, "clientHeight" | "clientWidth">;
}): Promise<unknown> {
  const whole = viewportPiecesOf(request.clip, viewport);
  const firstClip = whole[0]?.[0]?.clip;
  if (!firstClip || (whole.length === 1 && whole[0]?.length === 1)) {
    return await send(request);
  }
  const { quality: _quality, ...rest } = request;
  const take = async (clip: Clip) => {
    // The debugger's answer, typed by the protocol rather than checked.
    const { data } = (await send({
      ...rest,
      clip,
      format: "png",
    })) as Protocol.Page.CaptureScreenshotResponse;
    return codec.decode(Buffer.from(data, "base64"));
  };
  // The first piece says how many pixels a unit of the clip comes out as,
  // which the device's scale and the page's zoom decide between them.
  const first = await take(firstClip);
  const pixelsPerUnit = {
    x: first.width / firstClip.width,
    y: first.height / firstClip.height,
  };
  const capped = cappedClip(request.clip, pixelsPerUnit, maxPixels);
  const rows = viewportPiecesOf(capped, viewport);
  let image: Bitmap | undefined;
  let top = 0;
  for (const row of rows) {
    const taken: { bitmap: Bitmap; skip: Piece["skip"] }[] = [];
    for (const { clip, skip } of row) {
      taken.push({
        bitmap:
          clip.width === firstClip.width &&
          clip.height === firstClip.height &&
          clip.x === firstClip.x &&
          clip.y === firstClip.y
            ? first
            : await take(clip),
        skip: {
          x: Math.round(skip.x * pixelsPerUnit.x),
          y: Math.round(skip.y * pixelsPerUnit.y),
        },
      });
    }
    // As wide as the first row came out, and as tall as the rows could come
    // out with each rounded up, which the end cuts back to what they did.
    image ??= blank({
      height: Math.min(
        maxPixels,
        Math.ceil(capped.height * pixelsPerUnit.y) + rows.length,
      ),
      width: Math.min(
        maxPixels,
        taken.reduce(
          (sum, { bitmap, skip }) => sum + Math.max(0, bitmap.width - skip.x),
          0,
        ),
      ),
    });
    let left = 0;
    let rowHeight = 0;
    for (const { bitmap, skip } of taken) {
      const placed = drawPiece(image, bitmap, { left, skip, top });
      left += placed.width;
      rowHeight = placed.height;
    }
    top += rowHeight;
  }
  if (!image) {
    return await send(request);
  }
  const height = Math.min(image.height, top);
  return {
    data: codec
      .encode(
        {
          data: image.data.subarray(0, image.width * height * 4),
          height,
          width: image.width,
        },
        request.format,
        request.quality,
      )
      .toString("base64"),
  } satisfies Protocol.Page.CaptureScreenshotResponse;
}

function blank({ height, width }: { height: number; width: number }): Bitmap {
  return { data: Buffer.alloc(width * height * 4), height, width };
}
