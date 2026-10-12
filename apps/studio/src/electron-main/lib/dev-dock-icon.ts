/**
 * Draws a development instance's color as a dot in the lower right of its Dock
 * icon, on a white ring so it reads against the slate artwork and the Dock
 * behind it. Geometry is on a 512 canvas and scales with the image; the dot
 * sits over the icon grid's corner margin, where the artwork is transparent.
 *
 * Writes into a premultiplied BGRA bitmap in place, the layout
 * `nativeImage.toBitmap()` hands back.
 */
export function drawCornerDot(bitmap: Buffer, size: number, hex: string) {
  const scale = size / 512;
  const center = 418 * scale;
  drawDisc(bitmap, size, center, 64 * scale, [255, 255, 255]);
  drawDisc(bitmap, size, center, 52 * scale, parseHex(hex));
}

function drawDisc(
  bitmap: Buffer,
  size: number,
  center: number,
  radius: number,
  [red, green, blue]: [number, number, number],
) {
  const from = Math.max(0, Math.floor(center - radius - 1));
  const to = Math.min(size - 1, Math.ceil(center + radius + 1));
  for (let y = from; y <= to; y++) {
    for (let x = from; x <= to; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      // A pixel's share of the disc, for an edge without stairs.
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance));
      if (coverage === 0) {
        continue;
      }
      const at = (y * size + x) * 4;
      const keep = 1 - coverage;
      bitmap[at] = Math.round(blue * coverage + (bitmap[at] ?? 0) * keep);
      bitmap[at + 1] = Math.round(
        green * coverage + (bitmap[at + 1] ?? 0) * keep,
      );
      bitmap[at + 2] = Math.round(
        red * coverage + (bitmap[at + 2] ?? 0) * keep,
      );
      bitmap[at + 3] = Math.round(
        255 * coverage + (bitmap[at + 3] ?? 0) * keep,
      );
    }
  }
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
