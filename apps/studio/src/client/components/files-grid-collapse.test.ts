import { describe, expect, it } from "vitest";

import { collapseFor, type CollapseItem } from "./files-grid-collapse";

/**
 * The rules the collapsed files grid follows, as numbers.
 *
 * Where the boxes actually land is a question for the browser project (see
 * `files-grid.browser.test.tsx`); what a clamp does with them once they have
 * landed is arithmetic, and these are the cases that arithmetic was written
 * for.
 *
 * Every box below is measured from the top of the clamped grid, which starts
 * its content 8px in -- the padding that keeps card shadows out of the clip.
 */

// A wrapped section, as rows of equal boxes: `rows(3, 2, 48)` is three rows of
// two 48px-tall chips, in the order the DOM holds them.
function rows(count: number, perRow: number, height: number, gap = 8) {
  const items: CollapseItem[] = [];
  for (let row = 0; row < count; row++) {
    const top = 8 + row * (height + gap);
    for (let column = 0; column < perRow; column++) {
      items.push({ bottom: top + height, top });
    }
  }
  return items;
}

describe("collapseFor", () => {
  it("keeps two rows of chips and offers the rest", () => {
    // Rows at 8, 64 and 120; the clamp is 144, so the third row is cut and its
    // three files are what the button offers.
    expect(collapseFor(rows(6, 3, 48))).toMatchInlineSnapshot(`
      {
        "clipped": true,
        "height": 144,
        "hiddenFiles": 12,
      }
    `);
  });

  it("draws a grid whole when collapsing it would save less than the button costs", () => {
    // A third row ends at 168, 24px past the clamp -- less than the 36px the
    // button and its gap would add back. Cutting it saves nothing.
    expect(collapseFor(rows(3, 3, 48))).toMatchInlineSnapshot(`
      {
        "clipped": false,
        "height": undefined,
        "hiddenFiles": 0,
      }
    `);
  });

  it("never cuts the first row, however tall it is", () => {
    // A lone image is a full-width square, taller on its own than the clamp.
    expect(collapseFor(rows(1, 1, 400))).toMatchInlineSnapshot(`
      {
        "clipped": false,
        "height": undefined,
        "hiddenFiles": 0,
      }
    `);
  });

  it("clamps below the first row's own height when there is more under it", () => {
    // Three rows of media tiles: the first survives whole and the clamp lands a
    // fade's width below it, so the second row shows as a dissolving sliver and
    // both of the rows past it are offered.
    expect(collapseFor(rows(3, 3, 208))).toMatchInlineSnapshot(`
      {
        "clipped": true,
        "height": 248,
        "hiddenFiles": 6,
      }
    `);
  });

  it("counts a file it cuts in half, not just the ones it hides outright", () => {
    // The second row starts inside the clamp and ends past it. Half a card is
    // not a card you have seen, and expanding is about to reveal it.
    const visible = { bottom: 56, top: 8 } satisfies CollapseItem;
    const cut = { bottom: 200, top: 64 } satisfies CollapseItem;

    expect(collapseFor([visible, cut])).toMatchInlineSnapshot(`
      {
        "clipped": true,
        "height": 144,
        "hiddenFiles": 1,
      }
    `);
  });

  it("fades over a pending tile without offering to show it", () => {
    // The room held for a path still being typed. It takes space like a card,
    // so the clamp catches it and the fade covers it -- but there is nothing
    // behind it yet, so the button has nothing to offer and stays away.
    const items: CollapseItem[] = [
      ...rows(1, 3, 208),
      { bottom: 432, isPending: true, top: 224 },
    ];

    expect(collapseFor(items)).toMatchInlineSnapshot(`
      {
        "clipped": true,
        "height": 248,
        "hiddenFiles": 0,
      }
    `);
  });

  it("has nothing to say about an empty grid", () => {
    expect(collapseFor([])).toMatchInlineSnapshot(`
      {
        "clipped": false,
        "height": undefined,
        "hiddenFiles": 0,
      }
    `);
  });
});
