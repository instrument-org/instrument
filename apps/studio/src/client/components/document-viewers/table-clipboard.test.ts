import { describe, expect, it } from "vitest";

import { toCsv, toMarkdownTable } from "./table-clipboard";

const ROWS = [
  ["Product", "Per can", "Note"],
  ["Sparkling Ice", "$1.26", "Best value"],
];

describe("toMarkdownTable", () => {
  it("writes the first row as the header", () => {
    expect(toMarkdownTable(ROWS)).toMatchInlineSnapshot(`
      "| Product | Per can | Note |
      | --- | --- | --- |
      | Sparkling Ice | $1.26 | Best value |"
    `);
  });

  it("escapes what would forge a cell boundary", () => {
    expect(toMarkdownTable([["a"], ["x | y"], ["back\\slash"], ["two\nlines"]]))
      .toMatchInlineSnapshot(`
        "| a |
        | --- |
        | x \\| y |
        | back\\\\slash |
        | two lines |"
      `);
  });

  it("pads a short row and drops a long one's extra cells", () => {
    expect(toMarkdownTable([["a", "b"], ["only"], ["x", "y", "z"]]))
      .toMatchInlineSnapshot(`
        "| a | b |
        | --- | --- |
        | only |  |
        | x | y |"
      `);
  });

  it("has nothing to write without a header", () => {
    expect(toMarkdownTable([])).toBe("");
  });
});

describe("toCsv", () => {
  it("leaves a plain cell alone", () => {
    expect(toCsv(ROWS)).toMatchInlineSnapshot(`
      "Product,Per can,Note
      Sparkling Ice,$1.26,Best value"
    `);
  });

  it("quotes a cell holding a delimiter, a newline, or a quote", () => {
    expect(toCsv([["a,b", 'say "hi"', "two\nlines", "plain"]]))
      .toMatchInlineSnapshot(`
        ""a,b","say ""hi""","two
        lines",plain"
      `);
  });
});
