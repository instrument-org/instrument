import type { Protocol } from "devtools-protocol";

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

/** Whether a clip in document coordinates takes in the whole document. */
export function coversDocument(clip: Clip, content: Protocol.DOM.Rect) {
  return (
    clip.x <= content.x &&
    clip.y <= content.y &&
    clip.x + clip.width >= content.x + content.width &&
    clip.y + clip.height >= content.y + content.height
  );
}

/**
 * A clip cut into rows of pieces no larger than the viewport, left to right
 * and top down. A clip the viewport has room for is its own one piece.
 */
export function viewportPiecesOf(
  clip: Clip,
  viewport: Pick<Protocol.Page.LayoutViewport, "clientHeight" | "clientWidth">,
): Clip[][] {
  const maxWidth = Math.max(1, Math.floor(viewport.clientWidth / clip.scale));
  const maxHeight = Math.max(1, Math.floor(viewport.clientHeight / clip.scale));
  if (clip.width <= maxWidth && clip.height <= maxHeight) {
    return [[clip]];
  }
  const rows: Clip[][] = [];
  for (let top = 0; top < clip.height; top += maxHeight) {
    const row: Clip[] = [];
    for (let left = 0; left < clip.width; left += maxWidth) {
      row.push({
        height: Math.min(maxHeight, clip.height - top),
        scale: clip.scale,
        width: Math.min(maxWidth, clip.width - left),
        x: clip.x + left,
        y: clip.y + top,
      });
    }
    rows.push(row);
  }
  return rows;
}

/** Rows of pieces put back together as one image, each row as tall as its first piece. */
export function joinPieces(rows: Bitmap[][]): Bitmap {
  const width = (rows[0] ?? []).reduce((sum, piece) => sum + piece.width, 0);
  const height = rows.reduce((sum, row) => sum + (row[0]?.height ?? 0), 0);
  const data = Buffer.alloc(width * height * 4);
  let top = 0;
  for (const row of rows) {
    const rowHeight = row[0]?.height ?? 0;
    let left = 0;
    for (const piece of row) {
      const pixels = Math.min(piece.width, width - left);
      const lines = Math.min(piece.height, rowHeight);
      for (let line = 0; line < lines; line++) {
        const from = line * piece.width * 4;
        piece.data.copy(
          data,
          ((top + line) * width + left) * 4,
          from,
          from + pixels * 4,
        );
      }
      left += piece.width;
    }
    top += rowHeight;
  }
  return { data, height, width };
}

/**
 * Captures a clip that lies anywhere in the document, without scrolling the
 * page. A `<webview>` guest draws a clip beyond the viewport correctly only
 * up to the viewport's own size, and past that repeats the first viewport's
 * worth, so a larger clip is taken a viewport at a time and joined.
 */
export async function captureElement({
  codec,
  request,
  send,
  viewport,
}: {
  codec: ImageCodec;
  request: Protocol.Page.CaptureScreenshotRequest & { clip: Clip };
  /** Sends one capture to the guest's debugger. */
  send: (request: Protocol.Page.CaptureScreenshotRequest) => Promise<unknown>;
  viewport: Pick<Protocol.Page.LayoutViewport, "clientHeight" | "clientWidth">;
}): Promise<unknown> {
  const rows = viewportPiecesOf(request.clip, viewport);
  if (rows.length === 1 && rows[0]?.length === 1) {
    return await send(request);
  }
  const { quality: _quality, ...rest } = request;
  const pieces: Bitmap[][] = [];
  for (const row of rows) {
    const taken: Bitmap[] = [];
    for (const clip of row) {
      // The debugger's answer, typed by the protocol rather than checked.
      const { data } = (await send({
        ...rest,
        clip,
        format: "png",
      })) as Protocol.Page.CaptureScreenshotResponse;
      taken.push(codec.decode(Buffer.from(data, "base64")));
    }
    pieces.push(taken);
  }
  return {
    data: codec
      .encode(joinPieces(pieces), request.format, request.quality)
      .toString("base64"),
  } satisfies Protocol.Page.CaptureScreenshotResponse;
}
