import { describe, expect, it } from "vitest";

import {
  checkFeedbackImages,
  imageTypeOf,
  MAX_FEEDBACK_IMAGE_BYTES,
} from "./feedback-images";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string"
        ? Array.from(value, (char) => char.charCodeAt(0))
        : [value],
    ),
  );

const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a);

describe("imageTypeOf", () => {
  it.each([
    { expected: "image/png", head: PNG, name: "PNG" },
    {
      expected: "image/jpeg",
      head: bytes(0xff, 0xd8, 0xff, 0xe0),
      name: "JPEG",
    },
    { expected: "image/gif", head: bytes("GIF89a"), name: "GIF89a" },
    { expected: "image/gif", head: bytes("GIF87a"), name: "GIF87a" },
    {
      expected: "image/webp",
      head: bytes("RIFF", 0, 0, 0, 0, "WEBP"),
      name: "WebP",
    },
    { expected: null, head: bytes("RIFF", 0, 0, 0, 0, "WAVE"), name: "WAV" },
    { expected: null, head: bytes("<svg xmlns"), name: "SVG" },
    { expected: null, head: bytes("%PDF-1.7"), name: "PDF" },
    { expected: null, head: bytes(), name: "empty" },
  ])("reads $name as $expected", ({ expected, head }) => {
    expect(imageTypeOf(head)).toBe(expected);
  });
});

describe("checkFeedbackImages", () => {
  const file = (name: string, head = PNG, size = 1000) => ({
    head,
    name,
    size,
  });

  it("keeps images and says why each other file was left out", () => {
    const { accepted, problems } = checkFeedbackImages(2, [
      file("a.png"),
      file("notes.pdf", bytes("%PDF")),
      file("big.png", PNG, MAX_FEEDBACK_IMAGE_BYTES + 1),
      file("b.png"),
      file("x.png"),
    ]);
    expect(accepted.map((each) => [each.name, each.type])).toEqual([
      ["a.png", "image/png"],
      ["b.png", "image/png"],
    ]);
    expect(problems).toMatchInlineSnapshot(`
      [
        "“notes.pdf” isn't an image, so we left it out. You can attach PNG, JPEG, WebP or GIF.",
        "“big.png” is over 5 MB, so we left it out.",
        "You can attach up to 4 images, so we left out “x.png”.",
      ]
    `);
  });

  it("takes an image of exactly 5 MB", () => {
    expect(
      checkFeedbackImages(0, [file("a.png", PNG, MAX_FEEDBACK_IMAGE_BYTES)])
        .problems,
    ).toEqual([]);
  });
});
