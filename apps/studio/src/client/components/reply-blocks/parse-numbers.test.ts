import { describe, expect, it } from "vitest";

import { isWordsValue, parseNumbers } from "./parse-numbers";

describe("parseNumbers signs", () => {
  it.each([
    ["a hyphen", "Deductible: -$1,240", "−$1,240"],
    ["a minus sign", "Deductible: −$1,240", "−$1,240"],
    ["a spaced minus", "Fees: − $45", "−$45"],
    ["a bold bullet", "- **Change:** -$2,980", "−$2,980"],
    ["parentheses", "Refund owed: ($1,240)", "($1,240)"],
    ["a percent", "Margin: -4%", "−4%"],
    ["a plus", "Sales: +12%", "+12%"],
  ])("keeps the sign written as %s", (_name, line, value) => {
    expect(parseNumbers(line).figures[0]?.value).toBe(value);
  });

  it("keeps the sign with a note after the value", () => {
    expect(
      parseNumbers("Depreciation: -$1,830 (paid once the work is done)")
        .figures[0],
    ).toMatchInlineSnapshot(`
      {
        "label": "Depreciation",
        "note": "paid once the work is done",
        "value": "−$1,830",
      }
    `);
  });
});

describe("parseNumbers", () => {
  it("reads figures, their notes, and keeps what is not one", () => {
    expect(
      parseNumbers(
        "Revenue: $48,200 (up 12% from Q2)\n- **Clients:** 7\n**Rate**: 6.125%\nClosing costs: $4,980 — the highest\nA line that is no figure",
      ),
    ).toMatchInlineSnapshot(`
      {
        "figures": [
          {
            "label": "Revenue",
            "note": "up 12% from Q2",
            "value": "$48,200",
          },
          {
            "label": "Clients",
            "value": "7",
          },
          {
            "label": "Rate",
            "value": "6.125%",
          },
          {
            "label": "Closing costs",
            "note": "the highest",
            "value": "$4,980",
          },
        ],
        "rest": [
          "A line that is no figure",
        ],
      }
    `);
  });
});

describe("isWordsValue", () => {
  it.each([
    ["$2,734", false],
    ["6.125%", false],
    ["31 months", false],
    ["August", false],
    ["$1.2M per year", false],
    ["about $0.19 per kWh every month", true],
    ["about a third", true],
    ["In unit", true],
    ["**Lakeview Bank**", true],
  ])("reads %s as words: %s", (value, expected) => {
    expect(isWordsValue(value)).toBe(expected);
  });

  it("marks a worded figure", () => {
    expect(
      parseNumbers("Rate: about $0.19 per kWh every month\nUsage: 9,284 kWh")
        .figures,
    ).toMatchInlineSnapshot(`
      [
        {
          "isWords": true,
          "label": "Rate",
          "value": "about $0.19 per kWh every month",
        },
        {
          "label": "Usage",
          "value": "9,284 kWh",
        },
      ]
    `);
  });
});
