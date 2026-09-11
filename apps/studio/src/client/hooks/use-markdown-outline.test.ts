import { describe, expect, it } from "vitest";

import { pickActiveHeading } from "./use-markdown-outline";

// A view whose top edge sits at 100, with a 20px tolerance, over headings
// 300px apart, the first 32px into the document.
const TOP = 100;
const TOLERANCE = 20;
const topsFrom = (scrollTop: number) =>
  Array.from({ length: 6 }, (_, index) => TOP + 32 - scrollTop + index * 300);

const pick = (scrollTop: number, atEnd = false) =>
  pickActiveHeading(topsFrom(scrollTop), TOP, TOLERANCE, atEnd);

describe("pickActiveHeading", () => {
  it.each([
    { expected: 0, scrollTop: 0 },
    // The second heading is 12px under the top edge: within the tolerance,
    // so its section is the one being read.
    { expected: 1, scrollTop: 320 },
    // At 32px under, the first section still shows enough to count.
    { expected: 0, scrollTop: 300 },
    { expected: 1, scrollTop: 600 },
    { expected: 4, scrollTop: 1300 },
  ])(
    "reads heading $expected at scroll $scrollTop",
    ({ expected, scrollTop }) => {
      expect(pick(scrollTop)).toBe(expected);
    },
  );

  it("reads the first heading while above every one of them", () => {
    // A preamble before the first heading is that heading's section.
    expect(pickActiveHeading([500, 800], TOP, TOLERANCE, false)).toBe(0);
  });

  it("reads the last heading at the end of the document", () => {
    // Scrolled to the end with the last heading still below the top: it could
    // never be reached by scrolling, so the end is what reaches it.
    expect(pick(1150)).toBe(3);
    expect(pick(1150, true)).toBe(5);
  });

  it("answers nothing for a document with no headings", () => {
    expect(pickActiveHeading([], TOP, TOLERANCE, false)).toBe(-1);
    expect(pickActiveHeading([], TOP, TOLERANCE, true)).toBe(-1);
  });
});
