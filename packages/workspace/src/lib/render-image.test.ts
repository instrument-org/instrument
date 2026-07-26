import { execa } from "execa";
import { beforeAll, describe, expect, it } from "vitest";

import { FFMPEG_PATH } from "./ffmpeg";
import { measureImage, renderImage } from "./render-image";

async function drawTestImage(args: string[]) {
  const result = await execa(
    FFMPEG_PATH,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...args,
      "-frames:v",
      "1",
      "-f",
      "image2",
      "-c:v",
      "png",
      "pipe:1",
    ],
    { encoding: "buffer" },
  );
  return Buffer.from(result.stdout);
}

/**
 * A JPEG whose EXIF says it is a quarter turn from how its pixels are stored,
 * the shape a phone camera produces. Built by splicing a minimal APP1 segment
 * carrying only the orientation tag into an otherwise ordinary JPEG.
 */
function withExifOrientation(jpeg: Buffer, orientation: number) {
  // Little-endian TIFF header, then one IFD holding a single SHORT entry.
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x01_12, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff_e1, 0);
  header.writeUInt16BE(exif.byteLength + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}

const MAX_BYTES = 5 * 1024 * 1024;

let landscape: Buffer;

beforeAll(async () => {
  landscape = await drawTestImage([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=800x400:duration=1:rate=1",
  ]);
}, 30_000);

describe("measureImage", () => {
  it("reads plain dimensions", () => {
    expect(measureImage(landscape)).toEqual({ height: 400, width: 800 });
  });

  it("returns undefined for bytes that are not an image", () => {
    expect(measureImage(Buffer.from("not an image"))).toBeUndefined();
  });

  it.each([
    { expected: { height: 400, width: 800 }, orientation: 1 },
    { expected: { height: 400, width: 800 }, orientation: 3 },
    // 5-8 store the pixels a quarter turn from how they are displayed.
    { expected: { height: 800, width: 400 }, orientation: 6 },
    { expected: { height: 800, width: 400 }, orientation: 8 },
  ])(
    "reports displayed dimensions for EXIF orientation $orientation",
    async ({ expected, orientation }) => {
      const jpeg = await execa(
        FFMPEG_PATH,
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=800x400:duration=1:rate=1",
          "-frames:v",
          "1",
          "-f",
          "image2",
          "-c:v",
          "mjpeg",
          "pipe:1",
        ],
        { encoding: "buffer" },
      );

      expect(
        measureImage(
          withExifOrientation(Buffer.from(jpeg.stdout), orientation),
        ),
      ).toEqual(expected);
    },
    30_000,
  );
});

describe("renderImage", () => {
  it("resizes to the target and stays lossless when it fits", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: MAX_BYTES,
      target: { height: 200, width: 400 },
    });

    expect(result?.mediaType).toBe("image/png");
    expect(measureImage(result?.bytes ?? Buffer.alloc(0))).toEqual({
      height: 200,
      width: 400,
    });
  }, 30_000);

  it("falls back to JPEG when the byte budget is too small for PNG", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 6000,
      target: { height: 400, width: 800 },
    });

    expect(result?.mediaType).toBe("image/jpeg");
    expect(result?.bytes.byteLength).toBeLessThanOrEqual(6000);
  }, 30_000);

  it("shrinks past the target when no encoding of it fits", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 4000,
      target: { height: 400, width: 800 },
    });

    expect(result?.bytes.byteLength).toBeLessThanOrEqual(4000);
    expect(result?.width).toBeLessThan(800);
  }, 30_000);

  it("gives up rather than returning something over budget", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 1,
      target: { height: 400, width: 800 },
    });

    expect(result).toBeUndefined();
  }, 30_000);

  it("crops the requested region and magnifies it", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: MAX_BYTES,
      region: { height: 50, left: 100, top: 25, width: 100 },
      target: { height: 400, width: 800 },
    });

    expect(measureImage(result?.bytes ?? Buffer.alloc(0))).toEqual({
      height: 400,
      width: 800,
    });
  }, 30_000);

  it("crops in displayed coordinates for an EXIF-rotated source", async () => {
    // Stored 800x400, displayed 400x800. A region only valid against the
    // displayed image proves the rotation is applied before the crop.
    const jpeg = await execa(
      FFMPEG_PATH,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=800x400:duration=1:rate=1",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ],
      { encoding: "buffer" },
    );
    const rotated = withExifOrientation(Buffer.from(jpeg.stdout), 6);

    const result = await renderImage({
      bytes: rotated,
      maxBytes: MAX_BYTES,
      region: { height: 700, left: 10, top: 20, width: 300 },
      target: { height: 700, width: 300 },
    });

    expect(measureImage(result?.bytes ?? Buffer.alloc(0))).toEqual({
      height: 700,
      width: 300,
    });
  }, 30_000);

  it("returns undefined for bytes ffmpeg cannot decode", async () => {
    const result = await renderImage({
      bytes: Buffer.from("not an image"),
      maxBytes: MAX_BYTES,
      target: { height: 10, width: 10 },
    });

    expect(result).toBeUndefined();
  }, 30_000);
});
