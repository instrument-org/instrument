import { drawCornerDot } from "@/electron-main/lib/dev-dock-icon";
import { describe, expect, it } from "vitest";

function pixel(bitmap: Buffer, size: number, x: number, y: number) {
  const at = (y * size + x) * 4;
  return [...bitmap.subarray(at, at + 4)];
}

describe("drawCornerDot", () => {
  it("draws the color on a white ring and leaves the rest of the icon alone", () => {
    const size = 512;
    const bitmap = Buffer.alloc(size * size * 4);
    drawCornerDot(bitmap, size, "#c0434c");

    // BGRA.
    expect(pixel(bitmap, size, 418, 418)).toEqual([0x4c, 0x43, 0xc0, 255]);
    expect(pixel(bitmap, size, 418 + 58, 418)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, size, 256, 256)).toEqual([0, 0, 0, 0]);
  });

  it("scales the dot with the image", () => {
    const size = 256;
    const bitmap = Buffer.alloc(size * size * 4);
    drawCornerDot(bitmap, size, "#007fc3");

    expect(pixel(bitmap, size, 209, 209)).toEqual([0xc3, 0x7f, 0x00, 255]);
    expect(pixel(bitmap, size, 209 + 40, 209)).toEqual([0, 0, 0, 0]);
  });
});
