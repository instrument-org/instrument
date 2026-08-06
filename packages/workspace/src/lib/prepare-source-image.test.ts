import { execa } from "execa";
import { beforeAll, describe, expect, it } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";
import { FFMPEG_PATH } from "./ffmpeg";
import { prepareSourceImage } from "./prepare-source-image";
import { measureImage } from "./render-image";

/**
 * A HEIC still, 8x6, as a phone camera writes them.
 *
 * Inlined rather than drawn, because the bundled ffmpeg cannot write this
 * format any more than it can read it -- which is the whole point of the case.
 */
const HEIC_BASE64 =
  "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAACAAAAAYAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAmw9iHuRZVNwICBgCogABAAlEAcBhcshEU2QAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAADCAAAAAW1kYXQAAAAAAAAA0gAAAL4oAa+hFZAqkXuYJc/l243E7qVZunbODkkHzmzT12v6W1VAKovQKFP+b/TI3ZQi6oJ+jawTiDXTmhMIGLIZc0H0pwHEdFzqRjOJUjBDDviMDXlFnIiv/meglEQHqO7/cJFXKdBH9Xzkj5dlaldkb2XG/9PkrXpMC+J6dfd/OkAS9W0uD6SRfgWxJUc/SbwzdPc4IgslM3DFkGEJRpZ9NmZCpQ6OCTrOh43eovbgARCoaKYd/T9/DmUtZ7RfSlXg";

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

  it("names the file and the format when the format cannot be converted", async () => {
    const result = await prepareSourceImage({
      bytes: Buffer.from(HEIC_BASE64, "base64"),
      displayPath: "/mnt/Photos/IMG_4021.heic",
    });

    expect(result._unsafeUnwrapErr()).toMatchInlineSnapshot(
      `"Source image /mnt/Photos/IMG_4021.heic is in a format the image model does not accept (HEIC), and it could not be converted here. Pass a PNG, JPEG, or WebP copy instead."`,
    );
  }, 60_000);

  it("refuses a vector source, which has no pixels to condition on", async () => {
    const result = await prepareSourceImage({
      bytes: SVG_BYTES,
      displayPath: "output/logo.svg",
    });

    expect(result._unsafeUnwrapErr()).toContain("does not accept (SVG)");
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
