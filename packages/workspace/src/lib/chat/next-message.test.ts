import { describe, expect, it } from "vitest";

import { suggestionFrom } from "./next-message";

describe("suggestionFrom", () => {
  it.each([
    ["Move the duplicates to the Trash", "Move the duplicates to the Trash"],
    ['"ok, enabled it. try again"', "ok, enabled it. try again"],
    ["<think>they want the PDFs</think>Summarize both", "Summarize both"],
    ["Summarize both\nbecause they asked for three", "Summarize both"],
    ["<think>maybe they want the PDFs\nor the notes", undefined],
    ["", undefined],
    ["none", undefined],
    ["(nothing)", undefined],
    ["NONE", undefined],
    [
      "The conversation just ended on a thanks, so there's no next message to suggest.",
      undefined,
    ],
    [`Do ${"this and that ".repeat(12)}`, undefined],
    ["Suggestion: Summarize both", "Summarize both"],
    ["<suggestion>Yes, save it</suggestion>", "Yes, save it"],
    ["Looks good!", undefined],
    ["Let me check the other folder", undefined],
    ["Sure, save it", "Sure, save it"],
    ["Yes. Save it as rain.txt", "Yes. Save it as rain.txt"],
    ["Make it **bold**", undefined],
    ["Why merino instead of fleece?", "Why merino instead of fleece?"],
  ])("reads %j as %j", (answer, expected) => {
    expect(suggestionFrom(answer)).toBe(expected);
  });
});
