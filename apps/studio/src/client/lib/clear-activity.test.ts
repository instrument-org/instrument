import { describe, expect, it } from "vitest";

import { activityClearedMessage, thingsDetail } from "./clear-activity";

describe("clearing the history of what was done", () => {
  it.each([
    [0, "Nothing"],
    [1, "1 thing"],
    [14, "14 things"],
  ])("says %i in a box's detail line", (count, things) => {
    expect(thingsDetail(count)).toBe(things);
  });

  it("toasts what was cleared, and from when short of all time", () => {
    expect([
      activityClearedMessage({
        changes: false,
        opened: true,
        range: "hour",
        requests: false,
      }),
      activityClearedMessage({
        changes: true,
        opened: true,
        range: "week",
        requests: true,
      }),
      activityClearedMessage({
        changes: false,
        opened: false,
        range: "all",
        requests: true,
      }),
    ]).toEqual([
      "Cleared files and chats you opened from the last hour.",
      "Cleared files and chats you opened, changes you made, and AI usage from the last 7 days.",
      "Cleared AI usage.",
    ]);
  });
});
