import { describe, expect, it } from "vitest";

import {
  type ScrollGeometry,
  type ScrollMode,
  type ScrollSettings,
  isAtEnd,
  pinned,
  scrollableOf,
  settle,
} from "./policy";

const SETTINGS: ScrollSettings = { anchorRoom: 64, autoScroll: true };

function geometry(overrides: Partial<ScrollGeometry> = {}): ScrollGeometry {
  return {
    contentBottom: 2000,
    scrollTop: 0,
    spacer: 0,
    topInset: 16,
    viewportHeight: 600,
    ...overrides,
  };
}

const anchor = (contentAtAnchor: number): ScrollMode => ({
  contentAtAnchor,
  key: "sent",
  kind: "anchor",
});

describe("follow", () => {
  it("writes the end while anything can arrive", () => {
    expect(settle({ kind: "follow" }, geometry(), SETTINGS))
      .toMatchInlineSnapshot(`
      {
        "mode": {
          "kind": "follow",
        },
        "scrollTop": 1400,
        "spacer": 0,
      }
    `);
  });

  it("writes nothing once nothing can arrive", () => {
    expect(
      settle({ kind: "follow" }, geometry({ scrollTop: 300 }), {
        ...SETTINGS,
        autoScroll: false,
      }),
    ).toEqual({ mode: { kind: "follow" }, spacer: 0 });
  });
});

describe("anchor", () => {
  it("holds the message under the column's padding and the peek, with room under it", () => {
    // Message at 1900, near the end of 2000: the spacer makes the room.
    expect(
      settle(anchor(2000), geometry({ anchorTop: 1900 }), SETTINGS),
    ).toEqual({
      mode: anchor(2000),
      scrollTop: 1900 - 64 - 16,
      spacer: 1820 + 600 - 2000,
    });
  });

  it("follows the end once the reply has filled the room and still grows", () => {
    const write = settle(
      anchor(2000),
      geometry({ anchorTop: 1900, contentBottom: 2600 }),
      SETTINGS,
    );
    expect(write).toEqual({
      mode: { kind: "follow" },
      scrollTop: 2000,
      spacer: 0,
    });
  });

  it("stays anchored when the reply fills the room exactly but has not grown past it", () => {
    // Content already this tall at the send: a history long enough that no
    // spacer was needed. Nothing new has arrived, so nothing to follow.
    const write = settle(
      anchor(2600),
      geometry({ anchorTop: 1900, contentBottom: 2600 }),
      SETTINGS,
    );
    expect(write.mode.kind).toBe("anchor");
    expect(write.scrollTop).toBe(1820);
    expect(write.spacer).toBe(0);
  });

  it("keeps the reader in place once the anchored message is gone", () => {
    expect(
      settle(
        anchor(2000),
        geometry({ scrollTop: 1500, spacer: 400 }),
        SETTINGS,
      ),
    ).toEqual({ mode: { kind: "keep" }, spacer: 100 });
  });

  it("never scrolls above the top for a message near it", () => {
    expect(
      settle(
        anchor(800),
        geometry({ anchorTop: 40, contentBottom: 800 }),
        SETTINGS,
      ).scrollTop,
    ).toBe(0);
  });
});

describe("keep", () => {
  it.each([
    // [what, geometry, spacer kept]
    [
      "only what the position still needs",
      { scrollTop: 1500, spacer: 400 },
      100,
    ],
    [
      "none once the reply has grown into it",
      { contentBottom: 2400, scrollTop: 1500, spacer: 400 },
      0,
    ],
    ["never more than there was", { scrollTop: 1900, spacer: 200 }, 200],
    [
      "none once the reader scrolled above it",
      { scrollTop: 900, spacer: 400 },
      0,
    ],
  ])("keeps %s", (_what, overrides, spacer) => {
    expect(settle({ kind: "keep" }, geometry(overrides), SETTINGS)).toEqual({
      mode: { kind: "keep" },
      spacer,
    });
  });
});

describe("pinned", () => {
  it("carries an anchored message up as what is under it folds, keeping its room", () => {
    // 400px of work folded between the message at 1000 and the answer at
    // 1600: content shrank from 2000 to 1600, the answer is now at 1200 and
    // was 600px below the viewport's top.
    const g = geometry({
      anchorTop: 1000,
      contentBottom: 1600,
      scrollTop: 920,
      spacer: 0,
    });
    const write = pinned(
      settle(anchor(2000), g, SETTINGS),
      g,
      SETTINGS,
      1200 - 600,
    );
    expect(write).toEqual({
      mode: { ...anchor(2000), lift: 320 },
      scrollTop: 600,
      spacer: 0,
    });
    // The next frame, with nothing new pinned, the anchor stays carried.
    expect(settle(write.mode, g, SETTINGS).scrollTop).toBe(600);
  });

  it("stops at the top when there is nothing above to scroll away", () => {
    const g = geometry({ anchorTop: 100, contentBottom: 500 });
    expect(
      pinned(settle(anchor(900), g, SETTINGS), g, SETTINGS, -300).scrollTop,
    ).toBe(0);
  });

  it("moves a reader who took over with the row", () => {
    expect(
      pinned(
        { mode: { kind: "keep" }, spacer: 0 },
        geometry({ contentBottom: 1600, scrollTop: 1000 }),
        SETTINGS,
        700,
      ),
    ).toEqual({ mode: { kind: "keep" }, scrollTop: 700, spacer: 0 });
  });

  it("leaves following the end as it is, which already keeps the end still", () => {
    const write = settle({ kind: "follow" }, geometry(), SETTINGS);
    expect(pinned(write, geometry(), SETTINGS, 200)).toBe(write);
  });
});

describe("scrollableOf", () => {
  it("hides the jump to the end while the end is held", () => {
    const g = geometry({ scrollTop: 100 });
    expect(scrollableOf({ kind: "follow" }, g, SETTINGS)).toEqual({
      end: false,
      start: true,
    });
    expect(scrollableOf({ kind: "keep" }, g, SETTINGS)).toEqual({
      end: true,
      start: true,
    });
    expect(
      scrollableOf({ kind: "follow" }, g, { ...SETTINGS, autoScroll: false }),
    ).toEqual({ end: true, start: true });
  });
});

it.each([
  [1400, true],
  [1392, true],
  [1391, false],
])("counts scrollTop %i as at the end: %s", (scrollTop, atEnd) => {
  expect(isAtEnd(geometry({ scrollTop }))).toBe(atEnd);
});
