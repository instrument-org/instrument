import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";
import { FFMPEG_PATH } from "./ffmpeg";
import { canDecodeMedia, isCompleteImage, isReadablePdf } from "./probe-media";

const MINIMAL_PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n"),
  "latin1",
);

let directory: string;
let audioPath: string;
let videoPath: string;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "probe-media-"));
  audioPath = path.join(directory, "tone.wav");
  videoPath = path.join(directory, "bars.mp4");

  await execa(FFMPEG_PATH, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.2",
    audioPath,
  ]);
  await execa(FFMPEG_PATH, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:duration=0.2:rate=10",
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);
});

afterAll(async () => {
  await fs.rm(directory, { force: true, recursive: true });
});

describe("canDecodeMedia", () => {
  it("accepts audio ffprobe can read", async () => {
    expect(await canDecodeMedia({ absolutePath: audioPath })).toBe(true);
  });

  it("accepts video ffprobe can read", async () => {
    expect(await canDecodeMedia({ absolutePath: videoPath })).toBe(true);
  });

  it("refuses bytes that are not media at all", async () => {
    const decoyPath = path.join(directory, "decoy.mp4");
    await fs.writeFile(decoyPath, "<html><body>404</body></html>");
    expect(await canDecodeMedia({ absolutePath: decoyPath })).toBe(false);
  });

  it("refuses a video that stops partway through", async () => {
    // What an interrupted download leaves behind. MP4 keeps its index at the
    // end, so the half that arrived is unreadable rather than merely short.
    const whole = await fs.readFile(videoPath);
    const truncatedPath = path.join(directory, "truncated.mp4");
    await fs.writeFile(truncatedPath, whole.subarray(0, whole.byteLength / 2));
    expect(await canDecodeMedia({ absolutePath: truncatedPath })).toBe(false);
  });

  it("refuses a file with no bytes in it", async () => {
    const emptyPath = path.join(directory, "empty.mp3");
    await fs.writeFile(emptyPath, "");
    expect(await canDecodeMedia({ absolutePath: emptyPath })).toBe(false);
  });
}, 60_000);

describe("isReadablePdf", () => {
  it("accepts a PDF with both ends intact", () => {
    expect(isReadablePdf(MINIMAL_PDF)).toBe(true);
  });

  it("accepts a header sitting behind leading junk", () => {
    const padded = Buffer.concat([Buffer.alloc(64, 0x20), MINIMAL_PDF]);
    expect(isReadablePdf(padded)).toBe(true);
  });

  it("refuses bytes with no PDF header", () => {
    expect(isReadablePdf(Buffer.from("<html><body>404</body></html>"))).toBe(
      false,
    );
  });

  it("refuses a PDF whose end marker never arrived", () => {
    const truncated = MINIMAL_PDF.subarray(0, MINIMAL_PDF.byteLength - 6);
    expect(isReadablePdf(truncated)).toBe(false);
  });

  it("refuses a header buried too deep to be one", () => {
    const buried = Buffer.concat([Buffer.alloc(2048, 0x20), MINIMAL_PDF]);
    expect(isReadablePdf(buried)).toBe(false);
  });
});

describe("isCompleteImage", () => {
  const png = (trailing: Buffer) =>
    Buffer.concat([pngHeaderBytes({ height: 10, width: 10 }), trailing]);

  it.each([
    {
      bytes: () => png(Buffer.alloc(0)),
      expected: true,
      name: "a PNG carrying its IEND",
    },
    {
      // What an interrupted download leaves: the header parsed, so the file
      // still measures 10x10, and the marker that ends it never arrived.
      bytes: () =>
        pngHeaderBytes({ height: 10, width: 10 }).subarray(0, 20),
      expected: false,
      name: "a PNG cut off before its IEND",
    },
    {
      bytes: () => Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]),
      expected: true,
      name: "a JPEG ending in its end-of-image marker",
    },
    {
      // Editors and scanners leave padding past the marker, so the check scans
      // the tail rather than insisting the very last two bytes are it.
      bytes: () =>
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]),
          Buffer.alloc(16),
        ]),
      expected: true,
      name: "a JPEG with padding after its marker",
    },
    {
      bytes: () => Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]),
      expected: false,
      name: "a JPEG that stops mid-scan",
    },
  ])("$name", ({ bytes, expected, name }) => {
    const mediaType = name.includes("JPEG") ? "image/jpeg" : "image/png";
    expect(isCompleteImage(bytes(), mediaType)).toBe(expected);
  });

  it("catches a WebP whose payload is shorter than its RIFF header claims", () => {
    const webp = Buffer.alloc(64);
    webp.write("RIFF", 0, "latin1");
    webp.writeUInt32LE(4096, 4);
    webp.write("WEBP", 8, "latin1");

    expect(isCompleteImage(webp, "image/webp")).toBe(false);
    webp.writeUInt32LE(56, 4);
    expect(isCompleteImage(webp, "image/webp")).toBe(true);
  });

  it("has no opinion about a format it does not know", () => {
    // Saying "incomplete" for a format with no marker to look for would refuse
    // perfectly good files, so silence here means unknown, not broken.
    expect(isCompleteImage(Buffer.from("anything"), "image/avif")).toBe(true);
    expect(isCompleteImage(Buffer.from("anything"), undefined)).toBe(true);
  });
});
