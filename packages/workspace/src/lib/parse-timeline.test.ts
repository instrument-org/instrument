import { describe, expect, it } from "vitest";

import { parseTimeline } from "./parse-timeline";

describe("parseTimeline", () => {
  it.each([
    ["2 Aug: You tell the landlord.", "2 Aug", "You tell the landlord."],
    ["Fri 10:15 AM: Flight leaves", "Fri 10:15 AM", "Flight leaves"],
    ["10:15: Doors: both", "10:15", "Doors: both"],
    ["- Sep 5, 2026: Opened", "Sep 5, 2026", "Opened"],
    ["**Nov 28:** The claim closes", "Nov 28", "The claim closes"],
    ["**Nov 28**: The claim closes", "Nov 28", "The claim closes"],
    ["Nov 28: **The claim closes**", "Nov 28", "**The claim closes**"],
    ["2. August: Termin", "2. August", "Termin"],
    ["Nobody came", "", "Nobody came"],
  ])("reads %s", (line, when, what) => {
    expect(parseTimeline(line)).toEqual([{ what, when }]);
  });

  it("carries a line with no date on from the entry above it", () => {
    expect(
      parseTimeline(
        "\n2 Aug: You write to them.\n   No answer\n\n13 Aug: You write again.\n",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "what": "You write to them.
      No answer",
          "when": "2 Aug",
        },
        {
          "what": "You write again.",
          "when": "13 Aug",
        },
      ]
    `);
  });
});
