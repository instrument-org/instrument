import { describe, expect, it } from "vitest";

import { parseTimelineGroups } from "./parse-timeline-groups";

describe("parseTimelineGroups", () => {
  it("splits at headings and bold lines", () => {
    expect(
      parseTimelineGroups(
        "# Day 1, Friday\n4:30 PM: Leave\n6:15 PM: Ferry\n**Day 2:**\n9:00 AM: Breakfast\n**7:00 PM:** Dinner",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "heading": "Day 1, Friday",
          "lines": "4:30 PM: Leave
      6:15 PM: Ferry",
        },
        {
          "heading": "Day 2",
          "lines": "9:00 AM: Breakfast
      **7:00 PM:** Dinner",
        },
      ]
    `);
  });

  it("is one group with no heading", () => {
    expect(parseTimelineGroups("2 Aug: Leak\n13 Aug: Plumber")).toEqual([
      { lines: "2 Aug: Leak\n13 Aug: Plumber" },
    ]);
  });
});
