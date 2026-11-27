import { describe, expect, it } from "vitest";

import { WINDOW_TABS_KEY, unlistedTabGroups } from "./kept-state";

const key = (group: string) => `${WINDOW_TABS_KEY}/${group}`;

describe("unlistedTabGroups", () => {
  it("sweeps a group no window lists or with no tabs left", () => {
    const members = {
      [key("listed")]: {
        focused: 0,
        sides: [{ tabs: [{ id: "a", kind: "chat" }] }],
      },
      [key("unlisted")]: {
        focused: 0,
        sides: [{ tabs: [{ id: "b", kind: "chat" }] }],
      },
      [key("empty")]: { focused: 0, sides: [{ tabs: [] }] },
    };
    expect(unlistedTabGroups(members, new Set(["listed", "empty"]))).toEqual([
      key("unlisted"),
      key("empty"),
    ]);
  });

  it("keeps a listed group whose tabs this build cannot read", () => {
    const members = {
      [key("newer")]: {
        sides: [{ tabs: [{ id: "a", shape: "from a newer build" }] }],
      },
    };
    expect(unlistedTabGroups(members, new Set(["newer"]))).toEqual([]);
  });
});
