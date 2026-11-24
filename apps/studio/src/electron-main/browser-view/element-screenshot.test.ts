import type { Protocol } from "devtools-protocol";

import { describe, expect, it, vi } from "vitest";

import {
  type Bitmap,
  captureElement,
  coversDocument,
  type ImageCodec,
  joinPieces,
  viewportPiecesOf,
} from "./element-screenshot";

const VIEWPORT = { clientHeight: 800, clientWidth: 1280 };

/** A bitmap of one value per pixel, so a joined image reads as a grid of names. */
function filled(width: number, height: number, value: number): Bitmap {
  return { data: Buffer.alloc(width * height * 4, value), height, width };
}

/** The first byte of each pixel, a row per line. */
function grid({ data, height, width }: Bitmap) {
  return Array.from({ length: height }, (_row, y) =>
    Array.from(
      { length: width },
      (_pixel, x) => data[(y * width + x) * 4],
    ).join(""),
  );
}

describe("coversDocument", () => {
  const content = { height: 4836, width: 1280, x: 0, y: 0 };

  it.each([
    ["the document itself", { height: 4836, width: 1280, x: 0, y: 0 }, true],
    ["more than the document", { height: 5000, width: 1300, x: 0, y: 0 }, true],
    ["an element in it", { height: 90, width: 240, x: 40, y: 120 }, false],
    [
      "an element as wide as the page",
      { height: 1812, width: 1280, x: 0, y: 2970 },
      false,
    ],
    [
      "all but the top of the page",
      { height: 4816, width: 1280, x: 0, y: 20 },
      false,
    ],
  ])("%s", (_, clip, expected) => {
    expect(coversDocument({ ...clip, scale: 1 }, content)).toBe(expected);
  });
});

describe("viewportPiecesOf", () => {
  it("leaves a clip the viewport has room for whole, wherever it lies", () => {
    const clip = { height: 800, scale: 1, width: 300, x: 20, y: 2869.875 };
    expect(viewportPiecesOf(clip, VIEWPORT)).toEqual([[clip]]);
  });

  it("cuts a taller clip into viewport heights", () => {
    expect(
      viewportPiecesOf(
        { height: 1812, scale: 1, width: 512, x: 20, y: 2969.875 },
        VIEWPORT,
      ),
    ).toEqual([
      [{ height: 800, scale: 1, width: 512, x: 20, y: 2969.875 }],
      [{ height: 800, scale: 1, width: 512, x: 20, y: 3769.875 }],
      [{ height: 212, scale: 1, width: 512, x: 20, y: 4569.875 }],
    ]);
  });

  it("cuts a wider and taller clip both ways", () => {
    expect(
      viewportPiecesOf(
        { height: 900, scale: 1, width: 2000, x: 0, y: 10 },
        VIEWPORT,
      ).map((row) =>
        row.map(({ height, width, x, y }) => [x, y, width, height]),
      ),
    ).toEqual([
      [
        [0, 10, 1280, 800],
        [1280, 10, 720, 800],
      ],
      [
        [0, 810, 1280, 100],
        [1280, 810, 720, 100],
      ],
    ]);
  });

  it("counts a clip's scale against the viewport", () => {
    expect(
      viewportPiecesOf(
        { height: 500, scale: 2, width: 100, x: 0, y: 0 },
        VIEWPORT,
      ).map((row) => row.map(({ height, y }) => [y, height])),
    ).toEqual([[[0, 400]], [[400, 100]]]);
  });
});

describe("joinPieces", () => {
  it("puts rows of pieces back in place", () => {
    expect(
      grid(
        joinPieces([
          [filled(2, 2, 1), filled(1, 2, 2)],
          [filled(2, 1, 3), filled(1, 1, 4)],
        ]),
      ),
    ).toEqual(["112", "112", "334"]);
  });
});

describe("captureElement", () => {
  /** A codec whose PNG is a bitmap's own JSON. */
  const codec: ImageCodec = {
    decode: (png) => {
      const { height, value, width } = JSON.parse(png.toString()) as {
        height: number;
        value: number;
        width: number;
      };
      return filled(width, height, value);
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

  it("sends a clip the viewport has room for as asked", async () => {
    const request = {
      captureBeyondViewport: true,
      clip: { height: 80, scale: 1, width: 300, x: 20, y: 2869.875 },
      format: "png" as const,
    };
    const send = vi.fn().mockResolvedValue({ data: "AS-TAKEN" });

    await expect(
      captureElement({ codec, request, send, viewport: VIEWPORT }),
    ).resolves.toEqual({ data: "AS-TAKEN" });
    expect(send.mock.calls).toEqual([[request]]);
  });

  it("takes a clip taller than the viewport a viewport at a time and joins the pieces", async () => {
    // Each piece comes back one pixel wide and a pixel per 400 of its height,
    // filled with its place in the order.
    let taken = 0;
    const send = vi.fn((request: Protocol.Page.CaptureScreenshotRequest) => {
      taken += 1;
      return Promise.resolve({
        data: Buffer.from(
          JSON.stringify({
            height: Math.ceil((request.clip?.height ?? 0) / 400),
            value: taken,
            width: 1,
          }),
        ).toString("base64"),
      });
    });

    const result = (await captureElement({
      codec,
      request: {
        captureBeyondViewport: true,
        clip: { height: 1812, scale: 1, width: 512, x: 20, y: 2969.875 },
        format: "jpeg",
        fromSurface: true,
        quality: 60,
      },
      send,
      viewport: VIEWPORT,
    })) as Protocol.Page.CaptureScreenshotResponse;

    expect(send.mock.calls.map(([request]) => request)).toEqual([
      {
        captureBeyondViewport: true,
        clip: { height: 800, scale: 1, width: 512, x: 20, y: 2969.875 },
        format: "png",
        fromSurface: true,
      },
      {
        captureBeyondViewport: true,
        clip: { height: 800, scale: 1, width: 512, x: 20, y: 3769.875 },
        format: "png",
        fromSurface: true,
      },
      {
        captureBeyondViewport: true,
        clip: { height: 212, scale: 1, width: 512, x: 20, y: 4569.875 },
        format: "png",
        fromSurface: true,
      },
    ]);
    expect(JSON.parse(Buffer.from(result.data, "base64").toString())).toEqual({
      format: "jpeg",
      grid: ["1", "1", "2", "2", "3"],
      quality: 60,
    });
  });
});
