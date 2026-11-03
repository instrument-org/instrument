import { describe, expect, it } from "vitest";

import { suggestionFrom } from "./next-message";

describe("suggestionFrom", () => {
  it.each([
    ["Move the duplicates to the Trash", "Move the duplicates to the Trash"],
    ['"ok, enabled it. try again"', "ok, enabled it. try again"],
    ["<think>they want the PDFs</think>Summarize both", "Summarize both"],
    ["Summarize both\nbecause they asked for three", "Summarize both"],
    ["", undefined],
    ["none", undefined],
    ["(nothing)", undefined],
    ["NONE", undefined],
    [
      "The conversation just ended on a thanks, so there's no next message to suggest.",
      undefined,
    ],
    [`Do ${"this and that ".repeat(12)}`, undefined],
  ])("reads %j as %j", (answer, expected) => {
    expect(suggestionFrom(answer)).toBe(expected);
  });
});
