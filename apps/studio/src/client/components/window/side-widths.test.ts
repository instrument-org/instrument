import { describe, expect, it } from "vitest";

import { leftWidthAt, scrollToShow, shareAt, sideShare } from "./side-widths";

describe("leftWidthAt", () => {
  it.each([
    { share: 0.5, room: 1000, width: 500 },
    { share: 0.69, room: 1556, width: 1073.64 },
    // Kept in a wider window: the right side stops at its narrowest.
    { share: 0.8, room: 896, width: 656 },
    { share: 0.2, room: 896, width: 240 },
    // The row never lays out below two floors; before it is measured, nothing stands.
    { share: 0.69, room: 0, width: 0 },
  ])("lays out $share of $room as $width", ({ share, room, width }) => {
    expect(leftWidthAt(share, room)).toBeCloseTo(width);
  });
});

describe("sideShare", () => {
  it.each([
    { room: 500, chat: 250 },
    { room: 700, chat: 350 },
    { room: 908, chat: 360 },
    { room: 1180, chat: 412 },
    { room: 1264, chat: 496 },
    { room: 1700, chat: 500 },
    { room: 2500, chat: 500 },
  ])("gives a chat $chat of $room, on either side", ({ chat, room }) => {
    const left = sideShare({ chatSide: 0, room, share: undefined });
    const right = sideShare({ chatSide: 1, room, share: undefined });
    expect(left * room).toBeCloseTo(chat);
    expect((1 - right) * room).toBeCloseTo(chat);
  });

  it("keeps the person's share over the chat's width, the middle included", () => {
    expect(sideShare({ chatSide: 0, room: 2000, share: 0.5 })).toBe(0.5);
  });

  it("splits evenly with no chat's side, or before the row is measured", () => {
    expect(
      sideShare({ chatSide: undefined, room: 2000, share: undefined }),
    ).toBe(0.5);
    expect(sideShare({ chatSide: 0, room: 0, share: undefined })).toBe(0.5);
  });
});

describe("shareAt", () => {
  it.each([
    { width: 505, room: 1000, share: 0.5 },
    { width: 1300, room: 2000, share: 0.65 },
    { width: 900, room: 1000, share: 0.76 },
    { width: 100, room: 1000, share: 0.24 },
    { width: 300, room: 0, share: 0.5 },
  ])(
    "keeps $share for a gutter dragged to $width of $room",
    ({ width, room, share }) => {
      expect(shareAt(width, room)).toBeCloseTo(share);
    },
  );
});

describe("scrollToShow", () => {
  it.each([
    {
      name: "a side in view stays",
      start: 0,
      end: 440,
      scroll: 0,
      view: 600,
      to: 0,
    },
    {
      name: "a side past the right edge comes in",
      start: 448,
      end: 888,
      scroll: 0,
      view: 600,
      to: 288,
    },
    {
      name: "a side past the left edge comes in",
      start: 0,
      end: 440,
      scroll: 288,
      view: 600,
      to: 0,
    },
    {
      name: "a side wider than the view shows its start",
      start: 448,
      end: 888,
      scroll: 0,
      view: 300,
      to: 448,
    },
  ])("$name", ({ end, scroll, start, to, view }) => {
    expect(scrollToShow({ end, scroll, start, view })).toBe(to);
  });
});
