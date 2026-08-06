import type * as ExecaModule from "execa";

import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";
import { FFMPEG_PATH } from "./ffmpeg";
import {
  exceedsDecodeBudget,
  measureImage,
  renderImage,
  type RenderImageResult,
} from "./render-image";

// A spy that still calls through, so the fixtures below keep using real ffmpeg
// while one test can assert that ffmpeg was never reached.
vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof ExecaModule>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

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

/**
 * A HEIC still, the format a phone camera writes.
 *
 * A file rather than an inline constant, and 512x512 rather than a few pixels,
 * because size is what makes this fixture mean anything: a HEIC small enough to
 * sit inside ffmpeg's probe buffer decodes from a pipe just fine, so a tiny one
 * would pass against the very code this exists to catch. Committed rather than
 * drawn in a `beforeAll`, because ffmpeg reads this format but cannot write it.
 *
 * Regenerate with:
 *   ffmpeg -f lavfi -i testsrc=size=1024x768:duration=1:rate=1 -frames:v 1 src.png
 *   sips -s format heic src.png --out fixtures/assets/photo.heic
 */
const HEIC_FIXTURE = path.resolve(
  import.meta.dirname,
  "../../fixtures/assets/photo.heic",
);

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

describe("exceedsDecodeBudget", () => {
  it.each([
    { name: "an ordinary screenshot", size: { height: 1080, width: 1920 } },
    { name: "a 144M archival scan", size: { height: 12_000, width: 12_000 } },
  ])("admits $name", ({ size }) => {
    expect(exceedsDecodeBudget(size)).toBe(false);
  });

  it("refuses dimensions no decoder should be asked to hold", () => {
    expect(exceedsDecodeBudget({ height: 50_000, width: 50_000 })).toBe(true);
  });

  it("judges a decode bomb by its header, not its file size", () => {
    // 33 bytes declaring 256M pixels. A real flat-color PNG would be small too,
    // but building one costs the resources the guard exists to refuse.
    const bomb = pngHeaderBytes({ height: 16_000, width: 16_000 });
    const size = measureImage(bomb);

    expect(bomb.byteLength).toBeLessThan(64);
    expect(size).toMatchObject({ height: 16_000, width: 16_000 });
    expect(size && exceedsDecodeBudget(size)).toBe(true);
  });
});

describe("measureImage", () => {
  it("reads plain dimensions", () => {
    expect(measureImage(landscape)).toEqual({
      format: "png",
      height: 400,
      mediaType: "image/png",
      width: 800,
    });
  });

  it("returns undefined for bytes that are not an image", () => {
    expect(measureImage(Buffer.from("not an image"))).toBeUndefined();
  });

  it.each([
    {
      expected: {
        format: "jpg",
        height: 400,
        mediaType: "image/jpeg",
        width: 800,
      },
      orientation: 1,
    },
    {
      expected: {
        format: "jpg",
        height: 400,
        mediaType: "image/jpeg",
        width: 800,
      },
      orientation: 3,
    },
    // 5-8 store the pixels a quarter turn from how they are displayed.
    {
      expected: {
        format: "jpg",
        height: 800,
        mediaType: "image/jpeg",
        width: 400,
      },
      orientation: 6,
    },
    {
      expected: {
        format: "jpg",
        height: 800,
        mediaType: "image/jpeg",
        width: 400,
      },
      orientation: 8,
    },
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

    const image = renderedImage(result);
    expect(image?.mediaType).toBe("image/png");
    expect(measureImage(image?.bytes ?? Buffer.alloc(0))).toEqual({
      format: "png",
      height: 200,
      mediaType: "image/png",
      width: 400,
    });
  }, 30_000);

  it("reads a container that only decodes from a seekable input", async () => {
    const result = await renderImage({
      bytes: await fs.readFile(HEIC_FIXTURE),
      maxBytes: MAX_BYTES,
      target: { height: 256, width: 256 },
    });

    const image = renderedImage(result);
    expect(image?.mediaType).toBe("image/png");
    expect(measureImage(image?.bytes ?? Buffer.alloc(0))).toEqual({
      format: "png",
      height: 256,
      mediaType: "image/png",
      width: 256,
    });
  }, 30_000);

  it("falls back to JPEG when the byte budget is too small for PNG", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 6000,
      target: { height: 400, width: 800 },
    });

    const image = renderedImage(result);
    expect(image?.mediaType).toBe("image/jpeg");
    expect(image?.bytes.byteLength).toBeLessThanOrEqual(6000);
  }, 30_000);

  it("shrinks past the target when no encoding of it fits", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 4000,
      target: { height: 400, width: 800 },
    });

    const image = renderedImage(result);
    expect(image?.bytes.byteLength).toBeLessThanOrEqual(4000);
    expect(image?.width).toBeLessThan(800);
    // The size it reports has to be the size it produced, not the size it was
    // asked for. A caller announcing this in text has nothing else to go on.
    expect(measureImage(image?.bytes ?? Buffer.alloc(0))).toMatchObject({
      height: image?.height,
      width: image?.width,
    });
  }, 30_000);

  it("refuses a source over the pixel budget without starting ffmpeg", async () => {
    // The guard belongs here because this is the only place a decode begins, so
    // it has to hold for a caller that never checked. The refusal proves little
    // on its own -- these bytes have no pixel data, so ffmpeg would fail on them
    // anyway -- which is why the assertion is that ffmpeg never ran.
    vi.mocked(execa).mockClear();

    const result = await renderImage({
      bytes: pngHeaderBytes({ height: 20_000, width: 20_000 }),
      maxBytes: MAX_BYTES,
      target: { height: 200, width: 200 },
    });

    expect(result).toEqual({ state: "failed" });
    expect(execa).not.toHaveBeenCalled();
  });

  it("gives up rather than returning something over budget", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: 1,
      target: { height: 400, width: 800 },
    });

    expect(result).toEqual({ state: "failed" });
  }, 30_000);

  it("crops the requested region and magnifies it", async () => {
    const result = await renderImage({
      bytes: landscape,
      maxBytes: MAX_BYTES,
      region: { height: 50, left: 100, top: 25, width: 100 },
      target: { height: 400, width: 800 },
    });

    expect(
      measureImage(renderedImage(result)?.bytes ?? Buffer.alloc(0)),
    ).toEqual({
      format: "png",
      height: 400,
      mediaType: "image/png",
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

    expect(
      measureImage(renderedImage(result)?.bytes ?? Buffer.alloc(0)),
    ).toEqual({
      format: "png",
      height: 700,
      mediaType: "image/png",
      width: 300,
    });
  }, 30_000);

  it("blames the bytes when ffmpeg ran and could not decode them", async () => {
    const result = await renderImage({
      bytes: Buffer.from("not an image"),
      maxBytes: MAX_BYTES,
      target: { height: 10, width: 10 },
    });

    expect(result).toEqual({ state: "failed" });
  }, 30_000);
});

function renderedImage(result: RenderImageResult) {
  return result.state === "rendered" ? result.image : undefined;
}
