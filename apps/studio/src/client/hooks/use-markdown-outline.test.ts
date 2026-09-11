import { describe, expect, it } from "vitest";

import { pickVisibleHeadings } from "./use-markdown-outline";

// A view from 100 to 500 with a 20px tolerance, over headings 300px apart,
// the first 32px into the document.
const TOP = 100;
const BOTTOM = 500;
const TOLERANCE = 20;
const topsFrom = (scrollTop: number) =>
  Array.from({ length: 6 }, (_, index) => TOP + 32 - scrollTop + index * 300);

const pick = (scrollTop: number) =>
  pickVisibleHeadings(topsFrom(scrollTop), TOP, BOTTOM, TOLERANCE);

describe("pickVisibleHeadings", () => {
  it.each([
    // Headings at 132 and 432 are on screen; the third, at 732, is not.
    { expected: { end: 1, start: 0 }, scrollTop: 0 },
    // The second heading has passed the top; the first section is gone.
    { expected: { end: 2, start: 1 }, scrollTop: 340 },
    // Three on screen: 172, 472 (8px inside the bottom tolerance), and the
    // first, whose section still holds the top edge.
    { expected: { end: 2, start: 0 }, scrollTop: 260 },
    // At 482 the third is 2px outside the tolerance, and does not count.
    { expected: { end: 1, start: 0 }, scrollTop: 250 },
  ])("reads $expected at scroll $scrollTop", ({ expected, scrollTop }) => {
    expect(pick(scrollTop)).toEqual(expected);
  });

  it("keeps the previous section lit only while more than a sliver shows", () => {
    // The second heading sits 10px under the top edge: the first section is on
    // screen by 10px, which is under the tolerance, so it does not count.
    expect(pick(322)?.start).toBe(1);
    // At 30px it does.
    expect(pick(302)?.start).toBe(0);
  });

  it("reads the first heading while above every one of them", () => {
    // A preamble before the first heading is that heading's section.
    expect(pickVisibleHeadings([600, 900], TOP, BOTTOM, TOLERANCE)).toEqual({
      end: 0,
      start: 0,
    });
  });

  it("runs through the last heading at the end of the document", () => {
    // Scrolled to the end, the last two headings are on screen below the one
    // holding the top edge.
    expect(pick(1200)).toEqual({ end: 5, start: 3 });
  });

  it("answers nothing for a document with no headings", () => {
    expect(pickVisibleHeadings([], TOP, BOTTOM, TOLERANCE)).toBeNull();
  });
});
