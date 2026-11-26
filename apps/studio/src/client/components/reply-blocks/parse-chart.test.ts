import { describe, expect, it } from "vitest";

import {
  chartTicks,
  formatValue,
  isTimeSeries,
  parseChart,
} from "./parse-chart";

const TABLE = `| Insurer | Premium |
|---|---|
| Harbor Mutual | $1,842 |
| Pinecrest | $1,930 |`;

/** A chart as read, without the table it was read from. */
const chartOf = (body: string, header: Record<string, string> = {}) => {
  const chart = parseChart(body, header);
  if (!chart) {
    return undefined;
  }
  const { table: _table, ...rest } = chart;
  return rest;
};

describe("parseChart", () => {
  const months = (count: number) =>
    `| Month | Use |\n|---|---|\n${[
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
      .slice(0, count)
      .map((month, index) => `| ${month} | ${(index + 1) * 100} kWh |`)
      .join("\n")}`;

  it("reads a time series of four or more as a line, with the unit it carries", () => {
    expect(chartOf(months(4))).toMatchInlineSnapshot(`
      {
        "labels": [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
        ],
        "series": [
          {
            "decimals": 0,
            "name": "Use",
            "texts": [
              "100 kWh",
              "200 kWh",
              "300 kWh",
              "400 kWh",
            ],
            "values": [
              100,
              200,
              300,
              400,
            ],
          },
        ],
        "type": "line",
        "unit": {
          "prefix": "",
          "suffix": " kWh",
        },
      }
    `);
  });

  it("reads three points as bars", () => {
    expect(parseChart(months(3), {})?.type).toBe("bar");
  });

  it("takes the header's type, unit and highlight", () => {
    expect(
      parseChart(TABLE, {
        highlight: "**Pinecrest**",
        type: "line",
        unit: "€",
      }),
    ).toMatchObject({
      highlight: 1,
      type: "line",
      unit: { prefix: "€", suffix: "" },
    });
  });

  it("reads several series, an empty cell as no value", () => {
    expect(
      chartOf(
        "| Q | 2025 | 2026 |\n|---|---|---|\n| Q1 | 38 | 41 |\n| Q2 | 42 | |",
      )?.series,
    ).toMatchInlineSnapshot(`
      [
        {
          "decimals": 0,
          "name": "2025",
          "texts": [
            "38",
            "42",
          ],
          "values": [
            38,
            42,
          ],
        },
        {
          "decimals": 0,
          "name": "2026",
          "texts": [
            "41",
            "",
          ],
          "values": [
            41,
            null,
          ],
        },
      ]
    `);
  });

  it.each([
    ["words for values", "| Plan | Cost |\n|---|---|\n| A | a third less |"],
    ["no rows", "| Plan | Cost |\n|---|---|"],
    ["no table", "Plan: 4"],
    [
      "more rows than a chart draws",
      `| n | v |\n|---|---|\n${Array.from({ length: 25 }, (_, n) => `| ${n} | ${n} |`).join("\n")}`,
    ],
    [
      "more series than a chart draws",
      "| n | a | b | c | d | e |\n|---|---|---|---|---|---|\n| x | 1 | 2 | 3 | 4 | 5 |",
    ],
  ])("draws no chart from %s", (_, body) => {
    expect(parseChart(body, {})).toBeUndefined();
  });

  it.each([
    [["Jan", "Feb", "Mar"], true],
    [["2023", "2024", "FY25"], true],
    [["Q1 2025", "Q2 2025"], true],
    [["Week 1", "Week 2"], true],
    [["2026-01", "2026-02"], true],
    [["3 Aug", "Aug 10, 2026"], true],
    [["Rent", "Utilities"], false],
  ])("reads %j as time: %s", (labels, expected) => {
    expect(isTimeSeries(labels)).toBe(expected);
  });
});

describe("chartTicks", () => {
  it("stands gridlines at a round step from the baseline", () => {
    const cases: [number[], boolean][] = [
      [[2280, 412, 640], true],
      [[4200, 9100, 1250], true],
      [[960, 506, 1284], false],
      [[62, 71, 68], false],
      [[-40, 120], true],
      [[0, 0], true],
      [[0.2, 0.75], true],
    ];
    expect(
      cases.map(
        ([values, includeZero]) =>
          `${values.join(", ")} -> ${chartTicks(values, { includeZero }).join(", ")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "2280, 412, 640 -> 0, 1000, 2000, 3000",
        "4200, 9100, 1250 -> 0, 2500, 5000, 7500, 10000",
        "960, 506, 1284 -> 0, 500, 1000, 1500",
        "62, 71, 68 -> 60, 65, 70, 75",
        "-40, 120 -> -100, 0, 100, 200",
        "0, 0 -> 0, 0.25, 0.5, 0.75, 1",
        "0.2, 0.75 -> 0, 0.25, 0.5, 0.75",
      ]
    `);
  });
});

describe("formatValue", () => {
  it("writes every value of a series at its most decimals, in its unit", () => {
    const chart = parseChart(
      "| Month | Bill |\n|---|---|\n| Jun | 182.40 |\n| Jul | 164.5 |\n| Aug | 228 |",
      { unit: "$" },
    );
    const series = chart?.series[0];
    expect(
      series?.texts.map((text, row) =>
        formatValue(
          text,
          series.values[row] ?? 0,
          chart?.unit ?? { prefix: "", suffix: "" },
          series.decimals,
        ),
      ),
    ).toEqual(["$182.40", "$164.50", "$228.00"]);
  });

  it.each([
    ["$1,842.5", 1842.5, 2, "$1,842.50"],
    ["12%", 12, 1, "12.0%"],
    ["-$40", -40, 0, "-$40"],
    ["$1.2M", 1_200_000, 0, "$1.2M"],
    ["48200", 48_200, 0, "48,200"],
  ])(
    "writes %s at %s with %i decimals as %s",
    (text, value, decimals, expected) => {
      expect(
        formatValue(text, value, { prefix: "", suffix: "" }, decimals),
      ).toBe(expected);
    },
  );
});
