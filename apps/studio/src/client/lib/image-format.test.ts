import { describe, expect, it } from "vitest";

import { formatOfBytes, formatOfName } from "./image-format";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string"
        ? Array.from(new TextEncoder().encode(value))
        : [value],
    ),
  );

describe("formatOfBytes", () => {
  it.each([
    ["PNG", bytes(0x89, "PNG\r\n", 0x1a, "\n")],
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["GIF", bytes("GIF89a")],
    ["WebP", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
    ["TIFF", bytes(0x49, 0x49, 0x2a, 0x00)],
    ["TIFF", bytes(0x4d, 0x4d, 0x00, 0x2a)],
    ["BMP", bytes("BM", 0, 0)],
    ["ICO", bytes(0, 0, 1, 0)],
    ["AVIF", bytes(0, 0, 0, 0x1c, "ftypavif")],
    ["HEIC", bytes(0, 0, 0, 0x18, "ftypheic")],
  ])("reads %s", (format, signature) => {
    expect(formatOfBytes(signature)).toBe(format);
  });

  it("names nothing it does not know", () => {
    expect(formatOfBytes(bytes("<svg xmlns"))).toBeUndefined();
    expect(formatOfBytes(bytes(0, 0, 0, 0x18, "ftypmp42"))).toBeUndefined();
  });
});

describe("formatOfName", () => {
  it.each([
    ["shot.PNG", "PNG"],
    ["photo.jpeg", "JPEG"],
    ["IMG_0001.HEIF", "HEIC"],
    ["diagram.svg", undefined],
    ["README", undefined],
  ])("reads %s", (name, format) => {
    expect(formatOfName(name)).toBe(format);
  });
});
