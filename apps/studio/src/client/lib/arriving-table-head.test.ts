import { describe, expect, it } from "vitest";

import { withoutArrivingTableHead } from "./arriving-table-head";

describe("withoutArrivingTableHead", () => {
  it.each([
    { block: "| a", shown: "" },
    { block: "| a | b |", shown: "" },
    { block: "| a | b |\n", shown: "" },
    { block: "Intro\n| a | b |", shown: "Intro" },
    { block: "| a | b |\n|", shown: "" },
    { block: "| a | b |\n| - |", shown: "" },
    { block: "| a | b |\n| :-- | ", shown: "" },
    { block: "| a | b |\n| - | -", shown: "| a | b |\n| - | -" },
    { block: "| a | b |\n| --- | --- |", shown: "| a | b |\n| --- | --- |" },
    {
      block: "| a | b |\n| - | - |\n| 1",
      shown: "| a | b |\n| - | - |\n| 1",
    },
    { block: "| a \\| b |\n| - |", shown: "| a \\| b |\n| - |" },
    { block: "| a | b |\n| not a", shown: "| a | b |\n| not a" },
    { block: "| a | b |\n| - |\n", shown: "| a | b |\n| - |\n" },
    { block: "```sh\n| grep x", shown: "```sh\n| grep x" },
    { block: "a | b", shown: "a | b" },
  ])("shows $block as $shown", ({ block, shown }) => {
    expect(withoutArrivingTableHead(block)).toBe(shown);
  });
});
