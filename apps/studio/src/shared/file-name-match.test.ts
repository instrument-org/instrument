import { sort } from "radashi";
import { describe, expect, it } from "vitest";

import {
  fileNameMatchRank,
  fileNameWords,
  foldFileName,
} from "./file-name-match";

const rank = (name: string, typed: string) =>
  fileNameMatchRank(foldFileName(name), fileNameWords(typed));

describe("fileNameMatchRank", () => {
  it.each([
    ["Budget", "budget", 0],
    ["Budget 2026", "budget 2026", 0],
    ["Budget.xlsx", "budget", 1],
    ["Budget 2026.xlsx", "budget  2026", 1],
    ["2026 Budget.xlsx", "budget", 2],
    ["team-budget.xlsx", "budget", 2],
    ["team_budget.xlsx", "bud", 2],
    ["notes.budget", "budget", 2],
    ["2026 Budget.xlsx", "budget 2026", 2],
    ["Rebudgeted.xlsx", "budget", 3],
    ["2026 Rebudgeted.xlsx", "2026 budget", 3],
    ["teamBudget.xlsx", "budget", 3],
  ])("ranks %j for %j as %i", (name, typed, expected) => {
    expect(rank(name, typed)).toBe(expected);
  });

  it.each([
    ["Budget.xlsx", "bdgt"],
    ["Budget.xlsx", "budget 2026"],
    ["Budget.xlsx", "tegdub"],
    ["Budget.xlsx", ""],
    ["Budget.xlsx", "   "],
  ])("leaves %j out for %j", (name, typed) => {
    expect(rank(name, typed)).toBeUndefined();
  });

  it("finds a name whatever its case or the way its accents are spelled", () => {
    expect(rank("Résumé.PDF", "résumé")).toBe(1);
    expect(rank("résumé.pdf".normalize("NFD"), "RÉSUMÉ")).toBe(1);
  });

  it("orders names from the words exactly to the words anywhere inside", () => {
    const names = [
      "Rebudgeted.xlsx",
      "2026 Budget.xlsx",
      "Budget.xlsx",
      "budget",
    ];
    expect(sort(names, (name) => rank(name, "budget") ?? Infinity))
      .toMatchInlineSnapshot(`
        [
          "budget",
          "Budget.xlsx",
          "2026 Budget.xlsx",
          "Rebudgeted.xlsx",
        ]
      `);
  });
});
