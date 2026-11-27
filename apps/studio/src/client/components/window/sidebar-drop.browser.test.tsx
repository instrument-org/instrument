import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REST_MS, type Span, type Steady, steadyPick } from "./drag/landing";
import { type DropCarry, sidebarDropAt } from "./sidebar-drop";

/** Where the list starts down the window: the sidebar's top row stands above it. */
const LIST_TOP = 40;

/**
 * The sidebar as `GroupSidebar` lays it out, at fixed heights: a pinned row,
 * the divider, New, two rows, and the empty list under them. In the list's
 * px, the items stand at pinned 0-52, divider 54-67, New 69-105, b 107-159,
 * c 161-213, and the empty list from 215.
 */
function layOut() {
  document.body.innerHTML = `
    <nav aria-label="Tab groups" style="position: fixed; left: 0; top: 0; width: 240px; height: 600px; display: flex; flex-direction: column;">
      <div style="height: ${LIST_TOP}px; flex-shrink: 0;"></div>
      <div data-group-list="" style="position: relative; display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; overflow-y: auto;">
        <div data-drop-item="row:chat-a" data-drop-group="chat-a" data-drop-section="pinned" style="height: 52px; flex-shrink: 0;"></div>
        <div data-drop-item=":divider" style="height: 13px; flex-shrink: 0;"></div>
        <div data-drop-item=":new" style="height: 36px; flex-shrink: 0;"></div>
        <div data-drop-item="row:draft:b" data-drop-group="draft:b" data-drop-section="rest" style="height: 52px; flex-shrink: 0;"></div>
        <div data-drop-item="row:draft:c" data-drop-group="draft:c" data-drop-section="rest" style="height: 52px; flex-shrink: 0;"></div>
        <div data-drop-empty="" style="flex: 1; min-height: 0;"></div>
      </div>
    </nav>
  `;
}

const TAB: DropCarry = { carries: "tab", from: undefined };

/** A point over the list, at a height in the list's own px. */
const at = (y: number) => [120, LIST_TOP + y] as const;

beforeEach(layOut);
afterEach(() => {
  document.body.innerHTML = "";
});

/** The line a tab lands at between items, `top` its middle in the list's px. */
const line = (
  before: string | undefined,
  top: number,
  place: { after?: string; before?: string; pinned?: boolean },
) => ({
  before,
  gap: 0,
  kind: "between",
  place: { pinned: false, ...place },
  top,
});

/** The pick of a pointer that has rested where it is. */
function rested(y: number, spans: readonly Span[]) {
  const { next } = steadyPick({ at: y, now: 0, spans });
  return steadyPick({ at: y, now: REST_MS, spans, was: next }).pick;
}

describe("a tab over the sidebar", () => {
  // Rows' middles: chat-a 26, New 87, draft:b 133, draft:c 187; the line
  // moves on 6px past each.
  it.each([
    [
      "a pinned row's top half",
      20,
      line("row:chat-a", -1, { before: "chat-a", pinned: true }),
    ],
    [
      "a pinned row, just past its middle",
      30,
      line("row:chat-a", -1, { before: "chat-a", pinned: true }),
    ],
    [
      "a pinned row's bottom edge",
      48,
      line(":divider", 53, { after: "chat-a", pinned: true }),
    ],
    [
      "the divider",
      60,
      line(":divider", 53, { after: "chat-a", pinned: true }),
    ],
    [
      "New's top half",
      80,
      line(":divider", 53, { after: "chat-a", pinned: true }),
    ],
    ["New's bottom half", 100, line("row:draft:b", 106, { before: "draft:b" })],
    ["a row's middle", 130, line("row:draft:b", 106, { before: "draft:b" })],
    [
      "a row's bottom half",
      150,
      line("row:draft:c", 160, { after: "draft:b", before: "draft:c" }),
    ],
    [
      "the gap between two rows",
      160,
      line("row:draft:c", 160, { after: "draft:b", before: "draft:c" }),
    ],
    [
      "the last row's bottom half",
      210,
      line(undefined, 214, { after: "draft:c" }),
    ],
    [
      "the empty list under the rows",
      400,
      line(undefined, 214, { after: "draft:c" }),
    ],
  ])("over %s lands at %j", (_, y, drop) => {
    expect(sidebarDropAt(...at(y), TAB)).toEqual({ drop, isOver: true });
  });

  it.each([
    ["a pinned row's middle", 26, { group: "chat-a", kind: "into" }],
    ["a row's middle", 133, { group: "draft:b", kind: "into" }],
    [
      "New's middle, which takes nothing",
      87,
      line(":divider", 53, { after: "chat-a", pinned: true }),
    ],
    [
      "a row, outside its middle 44%",
      145,
      line("row:draft:c", 160, { after: "draft:b", before: "draft:c" }),
    ],
  ])("rested on %s lands at %j", (_, y, drop) => {
    expect(sidebarDropAt(...at(y), { ...TAB, pick: rested })).toEqual({
      drop,
      isOver: true,
    });
  });

  it("keeps the line where it was until the pointer is 6px past a row's middle", () => {
    let was: Steady = {};
    const carry: DropCarry = {
      ...TAB,
      pick: (y, spans) => {
        const { next, pick } = steadyPick({ at: y, now: 0, spans, was });
        was = next;
        return pick;
      },
    };
    const below = line("row:draft:c", 160, {
      after: "draft:b",
      before: "draft:c",
    });
    expect(sidebarDropAt(...at(150), carry).drop).toEqual(below);
    expect(sidebarDropAt(...at(130), carry).drop).toEqual(below);
    expect(sidebarDropAt(...at(126), carry).drop).toEqual(
      line("row:draft:b", 106, { before: "draft:b" }),
    );
  });

  it("never goes into its own group's row, however long it rests there", () => {
    const own: DropCarry = { carries: "tab", from: "draft:b", pick: rested };
    expect(sidebarDropAt(...at(133), own)).toEqual({
      drop: line("row:draft:b", 106, { before: "draft:b" }),
      isOver: true,
    });
  });

  it("is over the sidebar but lands nowhere above the list", () => {
    expect(sidebarDropAt(120, 20, TAB)).toEqual({
      drop: undefined,
      isOver: true,
    });
  });

  it("is off the sidebar beside it", () => {
    expect(sidebarDropAt(400, LIST_TOP + 130, TAB)).toEqual({
      drop: undefined,
      isOver: false,
    });
  });
});

describe("a whole group over the sidebar", () => {
  const GROUP: DropCarry = { carries: "group", gap: 54 };

  it.each([
    [
      "at the top, among the pinned rows",
      0,
      {
        before: "row:chat-a",
        gap: 54,
        kind: "between",
        place: { before: "chat-a", pinned: true },
        top: 0,
      },
    ],
    [
      "under the pinned rows",
      56,
      {
        before: ":divider",
        gap: 54,
        kind: "between",
        place: { after: "chat-a", pinned: true },
        top: 54,
      },
    ],
    [
      "under New",
      100,
      {
        before: "row:draft:b",
        gap: 54,
        kind: "between",
        place: { before: "draft:b", pinned: false },
        top: 107,
      },
    ],
    [
      "between two rows",
      165,
      {
        before: "row:draft:c",
        gap: 54,
        kind: "between",
        place: { after: "draft:b", before: "draft:c", pinned: false },
        top: 161,
      },
    ],
    [
      "at the end, over the empty list",
      400,
      {
        before: undefined,
        gap: 54,
        kind: "between",
        place: { after: "draft:c", pinned: false },
        top: 215,
      },
    ],
  ])("%s lands in the room nearest", (_, y, drop) => {
    expect(sidebarDropAt(...at(y), GROUP)).toEqual({
      drop,
      isOver: true,
    });
  });

  it.each([
    ["New's top half", 30, ":divider", { pinned: true }, 0],
    [
      "New's bottom half",
      40,
      "row:draft:b",
      { before: "draft:b", pinned: false },
      53,
    ],
  ])(
    "with nothing pinned, over %s, lands in the room nearest New's middle",
    (_, y, before, place, top) => {
      // The main list draws the line with nothing pinned: the line 0-13, New
      // 15-51, b 53-105.
      document.querySelector("[data-drop-item='row:chat-a']")?.remove();
      expect(sidebarDropAt(...at(y), GROUP)).toEqual({
        drop: { before, gap: 54, kind: "between", place, top },
        isOver: true,
      });
    },
  );

  it("takes no measure of a lifted row", () => {
    document
      .querySelector("[data-drop-item='row:draft:c']")
      ?.toggleAttribute("data-lifted", true);
    expect(sidebarDropAt(...at(400), GROUP)).toEqual({
      drop: {
        before: undefined,
        gap: 54,
        kind: "between",
        place: { after: "draft:b", pinned: false },
        top: 161,
      },
      isOver: true,
    });
  });
});
