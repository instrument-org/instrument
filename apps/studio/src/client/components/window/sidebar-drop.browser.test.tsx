import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type DropCarry, sidebarDropAt } from "./sidebar-drop";

/** Where the list starts down the window: the sidebar's top row stands above it. */
const LIST_TOP = 40;

/**
 * The sidebar as `GroupSidebar` lays it out, at fixed heights: a pinned row,
 * the divider, New, two rows, History, and the empty list under them. In the
 * list's px, the items stand at pinned 0-52, divider 54-67, New 69-105, b
 * 107-159, c 161-213, History 215-251, and the empty list from 253.
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
        <div data-drop-item=":history" style="height: 36px; flex-shrink: 0;"></div>
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

/** A tab's room in front of an item, which starts at that item's top. */
const room = (
  before: string,
  top: number,
  place: { after?: string; before?: string; pinned?: boolean },
) => ({
  before,
  gap: 54,
  kind: "between",
  place: { pinned: false, ...place },
  top,
});

describe("a tab over the sidebar", () => {
  it.each([
    ["a pinned row's middle", 20, { group: "chat-a", kind: "into" }],
    [
      "a pinned row's top edge",
      2,
      room("row:chat-a", 0, { before: "chat-a", pinned: true }),
    ],
    [
      "a pinned row's bottom edge",
      48,
      room(":divider", 54, { after: "chat-a", pinned: true }),
    ],
    ["a row's middle", 130, { group: "draft:b", kind: "into" }],
    [
      "a row, short of its bottom edge",
      150,
      { group: "draft:b", kind: "into" },
    ],
    [
      "the line between two rows",
      160,
      room("row:draft:c", 161, { after: "draft:b", before: "draft:c" }),
    ],
    [
      "a row's bottom edge",
      152,
      room("row:draft:c", 161, { after: "draft:b", before: "draft:c" }),
    ],
    [
      "the next row's top edge",
      167,
      room("row:draft:c", 161, { after: "draft:b", before: "draft:c" }),
    ],
    [
      "the first row's top edge",
      108,
      room("row:draft:b", 107, { before: "draft:b" }),
    ],
    ["New", 80, room("row:draft:b", 107, { before: "draft:b" })],
    [
      "the last row's bottom edge",
      210,
      room(":history", 215, { after: "draft:c" }),
    ],
    [
      "the empty list under the rows",
      400,
      room(":history", 215, { after: "draft:c" }),
    ],
    ["History", 230, room(":history", 215, { after: "draft:c" })],
    ["the divider", 60, undefined],
  ])("over %s lands %j", (_, y, drop) => {
    expect(sidebarDropAt(...at(y), TAB)).toEqual({ drop, isOver: true });
  });

  it("opens a room at the end, past the last item, in a list without History", () => {
    document.querySelector("[data-drop-item=':history']")?.remove();
    expect(sidebarDropAt(...at(400), TAB)).toEqual({
      drop: {
        before: undefined,
        gap: 54,
        kind: "between",
        place: { after: "draft:c", pinned: false },
        top: 215,
      },
      isOver: true,
    });
  });

  it("lands nowhere over its own group's row, but beside it in a room", () => {
    const own: DropCarry = { carries: "tab", from: "draft:b" };
    expect(sidebarDropAt(...at(130), own)).toEqual({
      drop: undefined,
      isOver: true,
    });
    expect(sidebarDropAt(...at(160), own)).toEqual({
      drop: room("row:draft:c", 161, { after: "draft:b", before: "draft:c" }),
      isOver: true,
    });
  });

  it("lands nowhere under History when the list has no space to spare", () => {
    const empty = document.querySelector<HTMLElement>("[data-drop-empty]");
    empty?.style.setProperty("display", "none");
    expect(sidebarDropAt(...at(400), TAB)).toEqual({
      drop: undefined,
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
        before: ":history",
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

  it("takes no measure of a lifted row", () => {
    document
      .querySelector("[data-drop-item='row:draft:c']")
      ?.toggleAttribute("data-lifted", true);
    expect(sidebarDropAt(...at(400), GROUP)).toEqual({
      drop: {
        before: ":history",
        gap: 54,
        kind: "between",
        place: { after: "draft:b", pinned: false },
        top: 215,
      },
      isOver: true,
    });
  });
});
