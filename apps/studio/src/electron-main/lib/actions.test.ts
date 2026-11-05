import { describe, expect, it } from "vitest";

import { windowActionOf } from "./actions";

describe("windowActionOf", () => {
  it.each([
    [{ kind: "screen", name: "Settings › General" }],
    [
      {
        kind: "folder",
        path: "/Users/sam/Downloads",
        selected: ["a.pdf", "Taxes/"],
      },
    ],
    [{ kind: "file", path: "/Users/sam/Downloads/a.pdf" }],
    [{ id: "kitchen-quotes", kind: "chat", title: "Kitchen remodel quotes" }],
    [{ kind: "error", message: "Couldn't move that file." }],
  ])("takes what a window sees: %j", (payload) => {
    expect(windowActionOf(payload)).toEqual(payload);
  });

  it("takes the window's word without a time of its own", () => {
    expect(
      windowActionOf({
        at: "2020-01-01T00:00:00.000Z",
        kind: "screen",
        name: "Apps",
      }),
    ).toEqual({ kind: "screen", name: "Apps" });
  });

  it.each([
    // Kinds the main process records where they happen.
    [{ kind: "page", url: "https://example.test/" }],
    [{ kind: "edit", path: "/Users/sam/a.md" }],
    [{ dropped: 5, kind: "capped", of: "day" }],
    // What the schema would not keep.
    [{ kind: "file" }],
    [{ kind: "screen", name: 3 }],
    [{ kind: "nothing" }],
    ["screen"],
    [null],
  ])("refuses %j", (payload) => {
    expect(windowActionOf(payload)).toBeUndefined();
  });
});
