import { describe, expect, it } from "vitest";

import { rehypeTableShape } from "./rehype-table-shape";
import { isShortCell, type ShapeCell, tableShape } from "./table-shape";

/** A Markdown table's rows as cells, its delimiter row left out. */
const cellsOf = (markdown: string) =>
  markdown
    .split("\n")
    .filter((line) => !/^\|[-:| ]+\|$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

/** A Markdown table's cells as the shape reads them, `**x**` as bold. */
const shapeOf = (markdown: string) => {
  const [head = [], ...rows] = cellsOf(markdown);
  const cell = (text: string): ShapeCell =>
    /^\*\*.*\*\*$/.test(text)
      ? { bold: true, text: text.slice(2, -2) }
      : { text };
  return tableShape(
    head.map(cell),
    rows.map((row) => row.map(cell)),
  );
};

const PROFIT = `|  | Q2 (Apr–Jun) | Q3 (Jul–Sep) | Change |
|---|---|---|---|
| In-store sales | $41,250 | $44,800 | +$3,550 |
| Online sales | $18,400 | $22,150 | +$3,750 |
| **Total sales** | **$59,650** | **$66,950** | **+$7,300** |
| Cost of goods | $23,860 | $26,780 | +$2,920 |
| Payroll | $14,200 | $14,900 | +$700 |
| Marketing | $3,100 | $4,250 | +$1,150 |
| Utilities | $1,280 | $1,410 | +$130 |
| Other expenses | $2,040 | $1,630 | −$410 |
| Rent | $4,500 | $4,500 | $0 |
| **Profit** | **$10,670** | **$13,480** | **+$2,810** |
| Profit margin | 17.9% | 20.1% | +2.2 pts |`;

const RANKING = `| # | Apartment | Rent | Commute | Why it ranks here |
|---|---|---|---|---|
| 1 | Maple Heights 5C | $2,280 | 15 min | In-unit laundry, the shortest commute, and a south-facing living room; the extra $130 over Linden buys back about an hour a week. |
| 2 | 1420 Linden Ave 3B | $2,150 | 22 min | Solid value with a renovated kitchen and good light, but laundry is shared in the basement and the bedroom faces the street. |
| 3 | 615 River Rd duplex | $2,400 | 28 min | The most space by far and a small yard, though it is over budget and the landlord wants a two-year lease. |`;

const INVOICES = `| Invoice | Client | Sent | Due | Amount | Status |
|---|---|---|---|---|---|
| 1041 | Maple Street Studio | Jul 2 | Aug 1 | $2,400 | Paid |
| 1042 | Riverbend Coffee Roasters | Jul 9 | Aug 8 | $4,550 | Paid |
| 1043 | Oakline Builders | Jul 20 | Aug 19 | $6,850 | Paid |`;

describe("tableShape", () => {
  it("fits a table of short figures in a narrow column, and scrolls it under that", () => {
    expect(shapeOf(PROFIT)).toMatchInlineSnapshot(`
      {
        "fit": 22,
        "labelWidth": 12.9,
        "narrow": "scroll",
      }
    `);
  });

  it("makes records of a table with sentences in it, titled past its rank", () => {
    expect(shapeOf(RANKING)).toMatchInlineSnapshot(`
      {
        "fit": 26,
        "narrow": "records",
        "ranks": [
          "1",
          "2",
          "3",
        ],
      }
    `);
  });

  it("makes records of a wide table of words", () => {
    expect(shapeOf(INVOICES)).toMatchObject({ narrow: "records" });
  });

  it.each([
    [
      "three short columns",
      "| Lender | Rate | Monthly |\n|---|---|---|\n| Lakeview Bank | 6.125% | $2,734 |",
    ],
    [
      "a label and a phrase",
      "| Plan | Notes |\n|---|---|\n| Saver | Cheapest each month, but the deductible is high |",
    ],
  ])("leaves %s a table in the narrowest chat", (_, markdown) => {
    expect(shapeOf(markdown).fit ?? 0).toBeLessThan(20);
  });

  it.each([
    [
      "a header that is not a rank",
      "| Year | Plan | Cost |\n|---|---|---|\n| 1 | A | $1 |\n| 2 | B | $2 |",
    ],
    [
      "numbers that are not 1 to n",
      "| # | Plan | Cost |\n|---|---|---|\n| 1041 | A | $1 |\n| 1042 | B | $2 |",
    ],
    ["an empty header over labels", PROFIT],
  ])("ranks nothing by %s", (_, markdown) => {
    expect(shapeOf(markdown).ranks).toBeUndefined();
  });

  it("makes records of a few rows of figures, the deciding column last", () => {
    expect(shapeOf(MORTGAGE)).toMatchInlineSnapshot(`
      {
        "fit": 30,
        "narrow": "records",
      }
    `);
  });

  it("scrolls a table of more rows, words or not", () => {
    expect(shapeOf(INVOICES_EIGHT)).toMatchObject({ narrow: "scroll" });
  });

  it.each([
    ["a last row labeled All", "| **All 4** | | **$9,000** |", [4]],
    ["a last row starting Total", "| Total | 4 | $9,000 |", [4]],
    [
      "a bold last row over bold figures",
      "| **Sum** | **4** | **$9,000** |",
      [4],
    ],
    [
      "a bold last row over plain words",
      "| **Delah** | Plenty | $9,000 |",
      undefined,
    ],
  ])("draws %s as a total", (_, last, totals) => {
    const shape = shapeOf(
      `| Who | Invoices | Owed |\n|---|---|---|\n| **Oakline Builders** | 1 | $3,800 |\n| Maple Street Studio | 2 | $900 |\n| Harborview Dental | 1 | $2,250 |\n| Fernwood Community Health | 3 | $3,200 |\n${last}`,
    );
    expect(shape.totals).toEqual(totals);
  });

  it("counts six rows and a total as few enough for records", () => {
    const rows = Array.from(
      { length: 6 },
      (_, n) => `| Client number ${n} | Riverbend | $${n},150 |`,
    );
    expect(
      shapeOf(
        `| Client | Who | Owed |\n|---|---|---|\n${rows.join("\n")}\n| **Total** | | **$15,900** |`,
      ),
    ).toMatchObject({ narrow: "records", totals: [6] });
  });

  it.each([
    ["Jul 8, 2026", true],
    ["$2,400.00", true],
    ["$1,150.00 (Aug 25)", true],
    ["+$14,400 (+104%)", true],
    ["Maple Street Studio", false],
    ["55 days overdue (half paid)", false],
    ["$7,230 (incl. 0.5 points)", false],
  ])("reads %s as short: %s", (text, short) => {
    expect(isShortCell(text)).toBe(short);
  });

  it("counts a short cell whole, so its column is as wide as it is", () => {
    const dates = (date: string) =>
      shapeOf(
        `| No. | Client | Sent | Total |\n|---|---|---|---|\n| 1041 | Maple Street Studio | ${date} | $2,400.00 |`,
      ).fit;
    expect(dates("Jul 8, 2026")).toBeGreaterThan(dates("Jul 8") ?? 0);
  });

  it("counts a file chip's icon and padding with its label", () => {
    const head = ["", "Harbor Mutual", "Keystone Home", "Pinecrest"];
    const rows = [
      ["Annual premium", "$1,842", "$1,615", "$1,930"],
      ["Water backup limit", "$10,000", "add-on, limit not stated", "$25,000"],
    ].map((row) => row.map((text) => ({ text })));
    const plain = tableShape(
      head.map((text) => ({ text })),
      rows,
    );
    const chips = tableShape(
      head.map((text) => ({ chips: text ? [text] : [], text })),
      rows,
    );
    expect(chips.fit ?? 0).toBeGreaterThan(plain.fit ?? 0);
  });
});

const MORTGAGE = `| Lender | Rate | Points | Monthly | 7-year cost if closing costs include points | 7-year cost if points are extra |
|---|---|---|---|---|---|
| **Lakeview Bank** | 6.125% | 0.5 | $2,734 | **$188,928** | **$191,178** |
| First Harbor | 6.190% | 0.25 | $2,752 | $190,418 | $191,543 |
| Summit Credit Union | 6.250% | 0 | $2,770 | $191,742 | $191,742 |`;

const INVOICES_EIGHT = `| No. | Client | Invoiced | Due | Total | Paid | Balance | Paid on |
|---|---|---|---|---|---|---|---|
| 1041 | Maple Street Studio | Jul 8 | Aug 7 | $2,400 | $2,400 | $0 | Aug 2 |
| 1042 | Riverbend Coffee Roasters | Jul 22 | Aug 21 | $1,150 | $1,150 | $0 | Aug 25 |
| 1043 | Oakline Builders | Aug 5 | Sep 4 | $3,800 | $0 | **$3,800** | |
| 1044 | Bright Path Tutoring | Aug 19 | Sep 18 | $650 | $650 | $0 | Sep 10 |
| 1045 | Maple Street Studio | Sep 2 | Oct 2 | $1,800 | $900 | **$900** | Oct 1 (partial) |
| 1046 | Harborview Dental | Sep 16 | Oct 16 | $2,250 | $0 | **$2,250** | |
| 1047 | Riverbend Coffee Roasters | Oct 7 | Nov 6 | $975 | $975 | $0 | Nov 4 |
| 1048 | Fernwood Community Health | Nov 3 | Dec 3 | $3,200 | $0 | **$3,200** | |`;

/** A table as `rehypeTableShape` is handed it, `**x**` as bold. */
const hastTable = (head: string[], rows: string[][]) => {
  const cell = (tagName: string) => (text: string) => ({
    children: /^\*\*.*\*\*/.test(text)
      ? [
          {
            children: [
              { type: "text", value: text.replace(/^\*\*(.*?)\*\*/, "$1") },
            ],
            properties: {},
            tagName: "strong",
            type: "element",
          },
          { type: "text", value: text.replace(/^\*\*.*?\*\*/, "") },
        ]
      : text === ""
        ? []
        : [{ type: "text", value: text }],
    properties: {},
    tagName,
    type: "element",
  });
  const row = (tagName: string) => (cells: string[]) => ({
    children: cells.map(cell(tagName)),
    properties: {},
    tagName: "tr",
    type: "element",
  });
  return {
    children: [
      {
        children: [row("th")(head)],
        properties: {},
        tagName: "thead",
        type: "element",
      },
      {
        children: rows.map(row("td")),
        properties: {},
        tagName: "tbody",
        type: "element",
      },
    ],
    properties: {},
    tagName: "table",
    type: "element",
  };
};

describe("rehypeTableShape", () => {
  it("wraps a record's values, skips its empty cells and marks its total", () => {
    const table = hastTable(
      ["Client", "Sent", "Owed", "Status"],
      [
        ["Oakline Builders", "Aug 5", "$3,800", "**83 days overdue**"],
        [
          "Maple Street Studio",
          "Sep 2",
          "$900",
          "**55 days overdue** (half paid)",
        ],
        ["Harborview Dental", "Sep 16", "$2,250", "**41 days overdue**"],
        ["**All 8**", "", "**$10,150**", ""],
      ],
    );
    rehypeTableShape()({ children: [table], type: "root" });
    const body = table.children[1]?.children ?? [];
    const halfPaid = body[1]?.children[3];
    expect(table.properties).toMatchObject({ dataNarrow: "records" });
    expect(halfPaid?.children.map((child) => child.tagName)).toEqual(["span"]);
    expect(body[3]?.properties).toMatchObject({ dataTotal: "" });
    expect(body[3]?.children[1]?.properties).toMatchObject({ dataBlank: "" });
    expect(body[0]?.children[1]?.properties).toMatchObject({ dataShort: "" });
    expect(halfPaid?.properties).not.toHaveProperty("dataShort");
  });
});
