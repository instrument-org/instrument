import { expect, test } from "vitest";

import { layoutPictureRows } from "./picture-rows-layout";

// The sets the picture card was drawn against: a wide, a square and a tall
// one, a panorama beside a phone shot, and five from a walk.
const THREE = [1.5, 1, 0.7];
const PANO_AND_TALL = [3, 0.46];
const FIVE = [1.5, 1, 0.7, 1.78, 0.46];

/** Each row as `width x height` per picture, the room a short row leaves after it. */
function rowsOf(ratios: number[], width: number) {
  const slots = layoutPictureRows(
    ratios.map((ratio) => ({ ratio })),
    width,
  );
  return slots.map(
    (slot) =>
      `${slot.width}x${slot.height}${slot.end > 0 ? ` +${slot.end}` : ""}`,
  );
}

test("lays a set out in rows that share a height, at a wide and a narrow chat", () => {
  expect({
    five: rowsOf(FIVE, 736),
    fiveNarrow: rowsOf(FIVE, 372),
    panoAndTall: rowsOf(PANO_AND_TALL, 736),
    three: rowsOf(THREE, 736),
  }).toMatchInlineSnapshot(`
    {
      "five": [
        "333x223",
        "222x223",
        "157x223",
        "356x200",
        "92x200 +276",
      ],
      "fiveNarrow": [
        "216x144",
        "144x144",
        "101x145",
        "259x145",
        "73x160 +299",
      ],
      "panoAndTall": [
        "736x245",
        "92x200 +644",
      ],
      "three": [
        "300x200",
        "200x200",
        "140x200 +72",
      ],
    }
  `);
});

test("gives a picture alone the column, up to its own size", () => {
  const lone = (ratio: number, width: number, height?: number) => {
    const [slot] = layoutPictureRows(
      [{ ratio, size: height ? { height, width: height * ratio } : undefined }],
      width,
    );
    return `${slot?.width}x${slot?.height}`;
  };

  expect({
    landscape: lone(1.5, 736),
    landscapeNarrow: lone(1.5, 372),
    small: lone(1.5, 736, 120),
    tall: lone(0.46, 736),
  }).toMatchInlineSnapshot(`
    {
      "landscape": "600x400",
      "landscapeNarrow": "372x248",
      "small": "180x120",
      "tall": "184x400",
    }
  `);
});
