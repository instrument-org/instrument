import { describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted((): unknown[] => []);

vi.mock("@instrument-org/workspace/electron", async (original) => ({
  ...(await original<object>()),
  recordAction: (action: unknown) => {
    recorded.push(action);
  },
}));

vi.mock("./dev-file-logger", () => ({ writeDevLogEntry: () => {} }));

import {
  noteInstalledUpdate,
  recordInstalledUpdate,
  windowActionOf,
} from "./actions";

describe("an update the launch found", () => {
  it("goes in the first workspace's log once it starts, and only once", () => {
    recordInstalledUpdate();
    expect(recorded).toEqual([]);
    noteInstalledUpdate({ from: "2.0.13", to: "2.0.14" });
    recordInstalledUpdate();
    recordInstalledUpdate();
    expect(recorded).toEqual([
      { from: "2.0.13", kind: "update", to: "2.0.14" },
    ]);
  });
});

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
    [{ kind: "file", path: "/Users/sam/Downloads/a.pdf" }],
    [{ kind: "edit", path: "/Users/sam/a.md" }],
    [{ dropped: 5, kind: "capped", of: "day" }],
    // What the schema would not keep.
    [{ kind: "folder" }],
    [{ kind: "screen", name: 3 }],
    [{ kind: "nothing" }],
    ["screen"],
    [null],
  ])("refuses %j", (payload) => {
    expect(windowActionOf(payload)).toBeUndefined();
  });
});
