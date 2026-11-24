import type { Protocol } from "devtools-protocol";

import { describe, expect, it, vi } from "vitest";

import {
  type Bitmap,
  cappedClip,
  captureClip,
  documentClip,
  drawPiece,
  type ImageCodec,
  viewportPiecesOf,
} from "./element-screenshot";

const VIEWPORT = { clientHeight: 800, clientWidth: 1280 };

/** A bitmap of one value per pixel, so a joined image reads as a grid of names. */
function filled(width: number, height: number, value: number): Bitmap {
  return { data: Buffer.alloc(width * height * 4, value), height, width };
}

/** A bitmap whose every row is filled with the next value, from `first`. */
function rowsFrom(width: number, height: number, first: number): Bitmap {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    data.fill(first + y, y * width * 4, (y + 1) * width * 4);
  }
  return { data, height, width };
}

/** The first byte of each pixel, a row per line. */
function grid({ data, height, width }: Bitmap) {
  return Array.from({ length: height }, (_row, y) =>
    Array.from(
      { length: width },
      (_pixel, x) => data[(y * width + x) * 4],
    ).join(","),
  );
}

/** Each piece as where it is taken from, its size, and what of it to skip. */
function placed(rows: ReturnType<typeof viewportPiecesOf>) {
  return rows.map((row) =>
    row.map(({ clip, skip }) => ({
      at: [clip.x, clip.y],
      size: [clip.width, clip.height],
      skip: [skip.x, skip.y],
    })),
  );
}

describe("documentClip", () => {
  it("is the document's own box at the page's scale", () => {
    expect(documentClip({ height: 4836, width: 1280, x: 0, y: 0 })).toEqual({
      height: 4836,
      scale: 1,
      width: 1280,
      x: 0,
      y: 0,
    });
  });
});

describe("cappedClip", () => {
  it.each([
    {
      name: "leaves a clip that comes out within the cap as it is",
      clip: { height: 4836, scale: 1, width: 1280, x: 0, y: 0 },
      pixelsPerUnit: { x: 2, y: 2 },
      expected: { height: 4836, width: 1280 },
    },
    {
      name: "cuts a taller one to just over what fills the cap",
      clip: { height: 30_000, scale: 1, width: 1280, x: 0, y: 0 },
      pixelsPerUnit: { x: 2, y: 2 },
      expected: { height: 8193, width: 1280 },
    },
    {
      name: "counts a scale that is no whole number",
      clip: { height: 30_000, scale: 1, width: 1280, x: 0, y: 0 },
      pixelsPerUnit: { x: 1.5, y: 1.5 },
      expected: { height: 10_924, width: 1280 },
    },
    {
      name: "cuts a wider one too, and keeps the corner",
      clip: { height: 600, scale: 1, width: 40_000, x: 12, y: 34 },
      pixelsPerUnit: { x: 1, y: 1 },
      expected: { height: 600, width: 16_385 },
    },
  ])("$name", ({ clip, expected, pixelsPerUnit }) => {
    expect(cappedClip(clip, pixelsPerUnit, 16_384)).toEqual({
      ...clip,
      ...expected,
    });
  });
});

describe("viewportPiecesOf", () => {
  it("leaves a clip the viewport has room for whole, wherever it lies", () => {
    const clip = { height: 800, scale: 1, width: 300, x: 20, y: 2869.875 };
    expect(viewportPiecesOf(clip, VIEWPORT)).toEqual([
      [{ clip, skip: { x: 0, y: 0 } }],
    ]);
  });

  it("cuts a taller clip into viewport heights, the last reaching back over the one before", () => {
    expect(
      placed(
        viewportPiecesOf(
          { height: 1812, scale: 1, width: 512, x: 20, y: 2969.875 },
          VIEWPORT,
        ),
      ),
    ).toEqual([
      [{ at: [20, 2969.875], size: [512, 800], skip: [0, 0] }],
      [{ at: [20, 3769.875], size: [512, 800], skip: [0, 0] }],
      [{ at: [20, 3981.875], size: [512, 800], skip: [0, 588] }],
    ]);
  });

  it("cuts a wider and taller clip both ways, every piece the viewport's size", () => {
    expect(
      placed(
        viewportPiecesOf(
          { height: 900, scale: 1, width: 2000, x: 0, y: 10 },
          VIEWPORT,
        ),
      ),
    ).toEqual([
      [
        { at: [0, 10], size: [1280, 800], skip: [0, 0] },
        { at: [720, 10], size: [1280, 800], skip: [560, 0] },
      ],
      [
        { at: [0, 110], size: [1280, 800], skip: [0, 700] },
        { at: [720, 110], size: [1280, 800], skip: [560, 700] },
      ],
    ]);
  });

  it("counts a clip's scale against the viewport", () => {
    expect(
      placed(
        viewportPiecesOf(
          { height: 500, scale: 2, width: 100, x: 0, y: 0 },
          VIEWPORT,
        ),
      ),
    ).toEqual([
      [{ at: [0, 0], size: [100, 400], skip: [0, 0] }],
      [{ at: [0, 100], size: [100, 400], skip: [0, 300] }],
    ]);
  });
});

describe("drawPiece", () => {
  it("puts pieces in place, and says how much of each there was to place", () => {
    const image = filled(3, 3, 0);
    const none = { x: 0, y: 0 };
    expect(
      drawPiece(image, filled(2, 2, 1), { left: 0, skip: none, top: 0 }),
    ).toEqual({ height: 2, width: 2 });
    drawPiece(image, filled(1, 2, 2), { left: 2, skip: none, top: 0 });
    drawPiece(image, filled(2, 1, 3), { left: 0, skip: none, top: 2 });
    drawPiece(image, filled(1, 1, 4), { left: 2, skip: none, top: 2 });

    expect(grid(image)).toEqual(["1,1,2", "1,1,2", "3,3,4"]);
  });

  it("leaves out the part of a piece an earlier one holds", () => {
    const image = filled(2, 3, 0);
    drawPiece(image, rowsFrom(2, 2, 1), {
      left: 0,
      skip: { x: 0, y: 0 },
      top: 0,
    });
    expect(
      drawPiece(image, rowsFrom(2, 2, 5), {
        left: 0,
        skip: { x: 0, y: 1 },
        top: 2,
      }),
    ).toEqual({ height: 1, width: 2 });

    expect(grid(image)).toEqual(["1,1", "2,2", "6,6"]);
  });

  it("leaves out what falls outside the image", () => {
    const image = filled(2, 2, 0);
    drawPiece(image, filled(3, 3, 7), {
      left: 1,
      skip: { x: 0, y: 0 },
      top: 1,
    });
    drawPiece(image, filled(3, 3, 9), {
      left: 2,
      skip: { x: 0, y: 0 },
      top: 0,
    });

    expect(grid(image)).toEqual(["0,0", "0,7"]);
  });
});

describe("captureClip", () => {
  /** A codec whose PNG is a bitmap's own JSON. */
  const codec: ImageCodec = {
    decode: (png) => {
      const { first, height, width } = JSON.parse(png.toString()) as {
        first: number;
        height: number;
        width: number;
      };
      return rowsFrom(width, height, first);
    },
    encode: (bitmap, format, quality) =>
      Buffer.from(
        JSON.stringify({
          format,
          grid: grid(bitmap),
          quality: quality ?? null,
        }),
      ),
  };

  /**
   * A guest whose page is one pixel wide and a pixel per `unit` of height,
   * each row of pixels holding its own place in the page.
   */
  function guest(unit: number) {
    return vi.fn((request: Protocol.Page.CaptureScreenshotRequest) =>
      Promise.resolve({
        data: Buffer.from(
          JSON.stringify({
            first: (request.clip?.y ?? 0) / unit,
            height: (request.clip?.height ?? 0) / unit,
            width: 1,
          }),
        ).toString("base64"),
      }),
    );
  }

  async function gridOf(result: unknown) {
    const { data } = (await result) as Protocol.Page.CaptureScreenshotResponse;
    return JSON.parse(Buffer.from(data, "base64").toString()) as {
      format: string;
      grid: string[];
      quality: number | null;
    };
  }

  it("sends a clip the viewport has room for as asked", async () => {
    const request = {
      captureBeyondViewport: true,
      clip: { height: 80, scale: 1, width: 300, x: 20, y: 2869.875 },
      format: "png" as const,
    };
    const send = vi.fn().mockResolvedValue({ data: "AS-TAKEN" });

    await expect(
      captureClip({ codec, request, send, viewport: VIEWPORT }),
    ).resolves.toEqual({ data: "AS-TAKEN" });
    expect(send.mock.calls).toEqual([[request]]);
  });

  it("takes a clip taller than the viewport a viewport at a time, each row of the page once", async () => {
    const send = guest(200);

    const result = await gridOf(
      captureClip({
        codec,
        request: {
          captureBeyondViewport: true,
          clip: { height: 2000, scale: 1, width: 512, x: 20, y: 1000 },
          format: "jpeg",
          fromSurface: true,
          quality: 60,
        },
        send,
        viewport: VIEWPORT,
      }),
    );

    expect(send.mock.calls.map(([request]) => request)).toEqual([
      {
        captureBeyondViewport: true,
        clip: { height: 800, scale: 1, width: 512, x: 20, y: 1000 },
        format: "png",
        fromSurface: true,
      },
      {
        captureBeyondViewport: true,
        clip: { height: 800, scale: 1, width: 512, x: 20, y: 1800 },
        format: "png",
        fromSurface: true,
      },
      {
        captureBeyondViewport: true,
        clip: { height: 800, scale: 1, width: 512, x: 20, y: 2200 },
        format: "png",
        fromSurface: true,
      },
    ]);
    expect(result).toEqual({
      format: "jpeg",
      // Rows 5 to 14 of the page: the last piece starts at row 11 and its
      // first two rows are skipped.
      grid: ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      quality: 60,
    });
  });

  it("cuts a capture that would come out larger than the cap to the cap exactly", async () => {
    const send = guest(200);

    const result = await gridOf(
      captureClip({
        codec,
        maxPixels: 6,
        request: {
          captureBeyondViewport: true,
          clip: { height: 20_000, scale: 1, width: 1280, x: 0, y: 0 },
          format: "png",
        },
        send,
        viewport: VIEWPORT,
      }),
    );

    expect(result.grid).toEqual(["0", "1", "2", "3", "4", "5"]);
    // Two pieces, the second ending a unit past what fills the cap: nothing
    // further down is asked of the guest.
    expect(send.mock.calls.map(([request]) => request.clip?.y)).toEqual([
      0, 401,
    ]);
  });
});
