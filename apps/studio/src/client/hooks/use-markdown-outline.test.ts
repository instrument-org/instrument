import { describe, expect, it } from "vitest";

import { pickActiveHeading } from "./use-markdown-outline";

// A viewport whose top edge sits at 100 and is 400 tall, so the reading line
// is at 200. Headings 300px apart, the first 32px into the document.
const READING_LINE = 200;
const topsFrom = (scrollTop: number) =>
  Array.from({ length: 6 }, (_, index) => 100 + 32 - scrollTop + index * 300);

describe("pickActiveHeading", () => {
  it.each([
    { expected: 0, scrollTop: 0 },
    // The second heading sits at 432 - 300 = 132 on screen, above the line.
    { expected: 1, scrollTop: 300 },
    // At 231 it is still below the line; the first section is being read.
    { expected: 0, scrollTop: 201 },
    { expected: 1, scrollTop: 232 },
    { expected: 4, scrollTop: 1300 },
  ])(
    "reads heading $expected at scroll $scrollTop",
    ({ expected, scrollTop }) => {
      expect(pickActiveHeading(topsFrom(scrollTop), READING_LINE, false)).toBe(
        expected,
      );
    },
  );

  it("reads the first heading while above every one of them", () => {
    // A preamble before the first heading is that heading's section.
    expect(pickActiveHeading([500, 800], READING_LINE, false)).toBe(0);
  });

  it("reads the last heading at the end of the document", () => {
    // Scrolled to the end with the last heading still below the line: it
    // could never be reached by scrolling, so the end is what reaches it.
    expect(pickActiveHeading(topsFrom(1150), READING_LINE, true)).toBe(5);
  });

  it("answers nothing for a document with no headings", () => {
    expect(pickActiveHeading([], READING_LINE, false)).toBe(-1);
    expect(pickActiveHeading([], READING_LINE, true)).toBe(-1);
  });
});
