import { describe, expect, it } from "vitest";

import { suggestionsFrom } from "./next-message";

describe("suggestionsFrom", () => {
  it.each([
    ["Move the duplicates to the Trash", ["Move the duplicates to the Trash"]],
    [
      "Add Help Scout to the comparison\nRedo it at 25 agents\nTurn it into a summary",
      [
        "Add Help Scout to the comparison",
        "Redo it at 25 agents",
        "Turn it into a summary",
      ],
    ],
    [
      "1. Summarize both\n2) Compare them\n- Save it",
      ["Summarize both", "Compare them", "Save it"],
    ],
    ["One\nTwo\nThree\nFour", ["One", "Two", "Three"]],
    [
      "Summarize both\n\nsummarize both\nCompare them",
      ["Summarize both", "Compare them"],
    ],
    ['"ok, enabled it. try again"', ["ok, enabled it. try again"]],
    ["<think>they want the PDFs</think>Summarize both", ["Summarize both"]],
    ["Summarize both\nbecause they asked for three", ["Summarize both"]],
    ["<think>maybe they want the PDFs\nor the notes", []],
    ["", []],
    ["none", []],
    ["(nothing)", []],
    ["NONE", []],
    [
      "The conversation just ended on a thanks, so there's no next message to suggest.",
      [],
    ],
    [`Do ${"this and that ".repeat(12)}`, []],
    ["Suggestion: Summarize both", ["Summarize both"]],
    ["<suggestion>Yes, save it</suggestion>", ["Yes, save it"]],
    ["Looks good!", []],
    [
      "Let me check the other folder\nCheck the other folder",
      ["Check the other folder"],
    ],
    ["Sure, save it", ["Sure, save it"]],
    ["Yes. Save it as rain.txt", ["Yes. Save it as rain.txt"]],
    ["Make it **bold**", []],
    ["Why merino instead of fleece?", ["Why merino instead of fleece?"]],
  ])("reads %j as %j", (answer, expected) => {
    expect(suggestionsFrom(answer)).toEqual(expected);
  });
});
