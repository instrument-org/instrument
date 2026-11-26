import { describe, expect, it } from "vitest";

import { type GroupReturn, groupToStepBackTo } from "./group-return";

const SETTINGS = { group: "settings", id: "s" };
const BACK: GroupReturn = {
  group: "settings",
  once: false,
  to: "chat",
};
const LISTED = ["chat", "settings"];

// A group made from another (Settings from Cmd+,, Open in New Tab Group, a
// chat with no tab) closes on Back from its start and returns to that one.
describe("the group Back from a group's one tab returns to", () => {
  it("is the group it was opened from", () => {
    expect(
      groupToStepBackTo(BACK, SETTINGS, { listed: LISTED, tabs: [SETTINGS] }),
    ).toBe("chat");
  });

  it.each<[string, GroupReturn | undefined, readonly string[], number]>([
    ["no return", undefined, LISTED, 1],
    ["a group made empty", { ...BACK, once: true }, LISTED, 1],
    ["another group's return", { ...BACK, group: "other" }, LISTED, 1],
    ["the group to return to gone", BACK, ["settings"], 1],
    ["a second tab in the group", BACK, LISTED, 2],
  ])("is none with %s", (_, back, listed, count) => {
    const tabs = [SETTINGS, { group: "settings", id: "t" }].slice(0, count);
    expect(groupToStepBackTo(back, SETTINGS, { listed, tabs })).toBeUndefined();
  });
});
