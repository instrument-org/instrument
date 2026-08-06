import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";
import { FFMPEG_PATH } from "./ffmpeg";
import { prepareSourceImage } from "./prepare-source-image";
import { measureImage } from "./render-image";

/** A HEIC still, the format an iPhone hands over. */
const HEIC_FIXTURE = path.resolve(
  import.meta.dirname,
  "../../fixtures/assets/photo.heic",
);

/**
 * An 8x8 JPEG carrying four color components instead of three: the CMYK a
 * print workflow produces and a designer hands over. Sniffs as an ordinary
 * JPEG, so nothing short of reading the frame header tells it apart.
 */
const CMYK_JPEG_BASE64 =
  "/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwANCQoLCggNCwoLDg4NDxMgFRMSEhMnHB4XIC4pMTAuKS0sMzpKPjM2RjcsLUBXQUZMTlJTUjI+WmFaUGBKUVJP/8AAFAgACAAIBEMRAE0RAFkRAEsRAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAA4EQwBNAFkASwAAPwBlgzWt3p1ocNMpiEZkBdP+XjZ8wyDwy45/kadpiixt9SuNL5jk/s/yBbHzGG0DduVckfxZz15pbsC/HhJvDvyraf3v3RP3N23djf0bO3NenV//2Q==";

const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>',
);

async function drawTestImage(args: string[], encoder: string[]) {
  const result = await execa(
    FFMPEG_PATH,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x64:duration=1:rate=1",
      ...args,
      "-frames:v",
      "1",
      "-f",
      "image2",
      ...encoder,
      "pipe:1",
    ],
    { encoding: "buffer" },
  );
  return Buffer.from(result.stdout);
}

let png: Buffer;
let gif: Buffer;

beforeAll(async () => {
  png = await drawTestImage([], ["-c:v", "png"]);
  gif = await drawTestImage([], ["-c:v", "gif"]);
}, 30_000);

describe("prepareSourceImage", () => {
  it("passes an ordinary PNG through byte for byte", async () => {
    const result = await prepareSourceImage({
      bytes: png,
      displayPath: "output/cat.png",
    });

    expect(result._unsafeUnwrap()).toBe(png);
  });

  it("converts a format the provider does not take", async () => {
    const result = await prepareSourceImage({
      bytes: gif,
      displayPath: "/mnt/Photos/cat.gif",
    });

    const prepared = result._unsafeUnwrap();
    expect(measureImage(prepared)).toMatchObject({
      height: 64,
      mediaType: "image/png",
      width: 64,
    });
  }, 30_000);

  it("converts a JPEG whose color components are not the three a screen uses", async () => {
    const cmyk = Buffer.from(CMYK_JPEG_BASE64, "base64");
    const result = await prepareSourceImage({
      bytes: cmyk,
      displayPath: "brand/logo.jpg",
    });

    const prepared = result._unsafeUnwrap();
    expect(prepared).not.toBe(cmyk);
    expect(measureImage(prepared)).toMatchObject({ mediaType: "image/png" });
  }, 30_000);

  it("converts the photo a phone hands over", async () => {
    const result = await prepareSourceImage({
      bytes: await fs.readFile(HEIC_FIXTURE),
      displayPath: "/mnt/Photos/IMG_4021.heic",
    });

    expect(measureImage(result._unsafeUnwrap())).toMatchObject({
      mediaType: "image/png",
    });
  }, 60_000);

  it("names the file and the format when the format cannot be converted", async () => {
    // A vector, which ffmpeg has no decoder for at any version: there are no
    // pixels in it to condition on until something rasterizes it.
    const result = await prepareSourceImage({
      bytes: SVG_BYTES,
      displayPath: "output/logo.svg",
    });

    expect(result._unsafeUnwrapErr()).toMatchInlineSnapshot(
      `"Source image output/logo.svg is in a format the image model does not accept (SVG), and it could not be converted here. Pass a PNG, JPEG, or WebP copy instead."`,
    );
  }, 60_000);

  it("refuses bytes that are not an image at all", async () => {
    const result = await prepareSourceImage({
      bytes: Buffer.from("<!doctype html><title>404</title>"),
      displayPath: "output/cat.png",
    });

    expect(result._unsafeUnwrapErr()).toContain("is not readable as an image");
  });

  it("refuses a truncated image rather than sending the half that arrived", async () => {
    const result = await prepareSourceImage({
      bytes: png.subarray(0, Math.floor(png.byteLength / 2)),
      displayPath: "output/cat.png",
    });

    expect(result._unsafeUnwrapErr()).toContain("is incomplete");
  });

  it("refuses dimensions no decoder should be asked to hold", async () => {
    const result = await prepareSourceImage({
      bytes: pngHeaderBytes({ height: 16_000, width: 16_000 }),
      displayPath: "output/scan.png",
    });

    expect(result._unsafeUnwrapErr()).toContain("too large to decode");
  });
});
