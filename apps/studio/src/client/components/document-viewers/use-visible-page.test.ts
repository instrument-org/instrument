import { describe, expect, it } from "vitest";

import { pickVisiblePage } from "./use-visible-page";

// A viewport whose top edge sits at 100, tall enough to hold two 500px pages
// laid out 24px apart -- the shape that makes a "most visible area" rule pick
// the wrong page.
const VIEWPORT_TOP = 100;
const pagesFrom = (scrollTop: number) =>
  Array.from({ length: 8 }, (_, index) => ({
    bottom: VIEWPORT_TOP + 34 - scrollTop + index * 524 + 500,
    index,
  }));

describe("pickVisiblePage", () => {
  it.each([
    { expected: 1, scrollTop: 0 },
    // A pixel of scroll does not turn the page, which is the whole complaint:
    // page one is still whole on screen here.
    { expected: 1, scrollTop: 1 },
    { expected: 1, scrollTop: 300 },
    // Page one's bottom edge crosses the top of the viewport at 534.
    { expected: 1, scrollTop: 533 },
    { expected: 2, scrollTop: 535 },
    { expected: 2, scrollTop: 1000 },
    { expected: 3, scrollTop: 1060 },
  ])("reads page $expected at scroll $scrollTop", ({ expected, scrollTop }) => {
    expect(pickVisiblePage(pagesFrom(scrollTop), VIEWPORT_TOP)).toBe(expected);
  });

  it("returns to the first page at the top of the document", () => {
    expect(pickVisiblePage(pagesFrom(2000), VIEWPORT_TOP)).toBe(4);
    expect(pickVisiblePage(pagesFrom(0), VIEWPORT_TOP)).toBe(1);
  });

  it("ignores document order, since a virtualized list may not keep it", () => {
    const pages = pagesFrom(600).reverse();

    expect(pickVisiblePage(pages, VIEWPORT_TOP)).toBe(2);
  });

  it("reads page one when nothing has rendered yet", () => {
    expect(pickVisiblePage([], VIEWPORT_TOP)).toBe(1);
  });

  it("holds on the last page once every page is above the viewport", () => {
    // Scrolled past the end, every bottom edge is behind the top of the
    // viewport; the answer is the last page rather than a snap back to one.
    const pages = pagesFrom(9000).filter((page) => page.index >= 6);

    expect(pickVisiblePage(pages, VIEWPORT_TOP)).toBe(8);
  });
});
