import { describe, expect, it } from "vitest";

import { arrivingTableLines, parseTable, readBlockHeader } from "./parse-body";

describe("readBlockHeader", () => {
  it("reads only the keys the block takes, up to the first other line", () => {
    expect(readBlockHeader("\nPick: 'Pinecrest'\ncolor: red\n| a |", "options"))
      .toMatchInlineSnapshot(`
      {
        "body": "color: red
      | a |",
        "header": {
          "pick": "Pinecrest",
        },
      }
    `);
  });

  it("reads no header from a block whose lines are figures", () => {
    expect(
      readBlockHeader("Title: The Hobbit\nPages: 310", "timeline").header,
    ).toEqual({});
  });
});

describe("arrivingTableLines", () => {
  const table = "| Plan | Price |\n| - | - |\n";

  it.each([
    { body: `${table}| Basic | $5 |\n| Pro | $`, row: "| Pro | $" },
    { body: `${table}| Basic | **fr`, row: "| Basic | **fr" },
    { body: `${table}| Bas`, row: "" },
    { body: `${table}| Basic | $5 |\n\nPick Basic | or`, row: "" },
    { body: "| Plan | Price |\n| - | -", row: "" },
    { body: "Two plans | both", row: "" },
  ])("draws $row of the row being written in $body", ({ body, row }) => {
    const complete = body.slice(0, body.lastIndexOf("\n") + 1);
    expect(arrivingTableLines(body)).toBe(complete + row);
  });
});

describe("parseTable", () => {
  it("reads cells, alignment, escaped pipes, and the lines around it", () => {
    expect(
      parseTable(
        "Before.\n| Name | Note | Cost |\n|:---|:-:|---:|\n| A \\| B | `x` | $3 |\n| C | short\nAfter.",
      ),
    ).toMatchInlineSnapshot(`
      {
        "after": "After.",
        "align": [
          "left",
          "center",
          "right",
        ],
        "before": "Before.",
        "head": [
          "Name",
          "Note",
          "Cost",
        ],
        "rows": [
          [
            "A | B",
            "\`x\`",
            "$3",
          ],
          [
            "C",
            "short",
            "",
          ],
        ],
      }
    `);
  });

  it("finds no table without its delimiter row", () => {
    expect(parseTable("| a | b |\n| c | d |")).toBeUndefined();
  });
});
