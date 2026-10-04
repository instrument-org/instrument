import { describe, expect, it } from "vitest";

import { checkAppIcon } from "./icon";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("checkAppIcon", () => {
  it.each([
    ["a 256px PNG", png(256, 256), { fileName: "icon.png" }],
    [
      "a square SVG",
      Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>',
      ),
      { fileName: "icon.svg" },
    ],
    [
      "a PNG too small",
      png(64, 64),
      { error: expect.stringContaining("at least 128px") },
    ],
    ["a wide PNG", png(256, 128), { error: expect.stringContaining("square") }],
    [
      "an SVG with no viewBox",
      Buffer.from("<svg width='10' height='10'/>"),
      { error: expect.stringContaining("viewBox") },
    ],
    [
      "text",
      Buffer.from("hello"),
      { error: expect.stringContaining("neither") },
    ],
  ])("%s", (_, bytes, expected) => {
    expect(checkAppIcon(bytes)).toEqual(expected);
  });
});
