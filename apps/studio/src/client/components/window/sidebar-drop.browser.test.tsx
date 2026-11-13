import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type DropCarry, sidebarDropAt } from "./sidebar-drop";

/** Where the list starts down the window: the sidebar's search stands above it. */
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

describe("a tab over the sidebar", () => {
  it.each([
    ["a pinned row", 20, { group: "chat-a", kind: "into" }],
    ["a row", 130, { group: "draft:b", kind: "into" }],
    [
      "the space between two rows, past halfway",
      160,
      { group: "draft:c", kind: "into" },
    ],
    [
      "the space between two rows, before halfway",
      159.5,
      { group: "draft:b", kind: "into" },
    ],
    ["New", 80, { kind: "new", over: "new" }],
    ["the empty list under the rows", 400, { kind: "new", over: "empty" }],
    ["the divider", 60, undefined],
    ["History", 230, undefined],
  ])("over %s lands %j", (_, y, drop) => {
    expect(sidebarDropAt(...at(y), TAB)).toEqual({ drop, isOver: true });
  });

  it("lands nowhere over its own group's row", () => {
    expect(
      sidebarDropAt(...at(130), { carries: "tab", from: "draft:b" }),
    ).toEqual({ drop: undefined, isOver: true });
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
  const group = (canPin: boolean): DropCarry => ({
    canPin,
    carries: "group",
    gap: 54,
  });

  it.each([
    [
      "a chat's, at the top, among the pinned rows",
      true,
      0,
      {
        before: "row:chat-a",
        gap: 54,
        kind: "between",
        place: { before: "chat-a", pinned: true },
      },
    ],
    [
      "a chat's, under the pinned rows",
      true,
      56,
      {
        before: ":divider",
        gap: 54,
        kind: "between",
        place: { after: "chat-a", pinned: true },
      },
    ],
    [
      "a draft's, at the top, under New",
      false,
      0,
      {
        before: "row:draft:b",
        gap: 54,
        kind: "between",
        place: { before: "draft:b", pinned: false },
      },
    ],
    [
      "between two rows",
      false,
      165,
      {
        before: "row:draft:c",
        gap: 54,
        kind: "between",
        place: { after: "draft:b", before: "draft:c", pinned: false },
      },
    ],
    [
      "at the end, over the empty list",
      false,
      400,
      {
        before: ":history",
        gap: 54,
        kind: "between",
        place: { after: "draft:c", pinned: false },
      },
    ],
  ])("%s lands in the room nearest", (_, canPin, y, drop) => {
    expect(sidebarDropAt(...at(y), group(canPin))).toEqual({
      drop,
      isOver: true,
    });
  });

  it("takes no measure of a lifted row", () => {
    document
      .querySelector("[data-drop-item='row:draft:c']")
      ?.toggleAttribute("data-lifted", true);
    expect(sidebarDropAt(...at(400), group(false))).toEqual({
      drop: {
        before: ":history",
        gap: 54,
        kind: "between",
        place: { after: "draft:b", pinned: false },
      },
      isOver: true,
    });
  });
});
