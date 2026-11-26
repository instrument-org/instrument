import { describe, expect, it } from "vitest";

import { parseValue } from "./parse-value";

describe("parseValue", () => {
  it("reads a number and the unit around it", () => {
    const cases = [
      "$1,842",
      "12%",
      "4.5 kWh",
      "-3",
      "−3",
      "(1,200)",
      "$1.2M",
      "-$40",
      "~40 hours",
      "**960**",
      "about a third",
      "1-2",
      "Q3",
    ];
    expect(Object.fromEntries(cases.map((text) => [text, parseValue(text)])))
      .toMatchInlineSnapshot(`
        {
          "$1,842": {
            "decimals": 0,
            "prefix": "$",
            "scaled": false,
            "suffix": "",
            "value": 1842,
          },
          "$1.2M": {
            "decimals": 1,
            "prefix": "$",
            "scaled": true,
            "suffix": "",
            "value": 1200000,
          },
          "(1,200)": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": "",
            "value": -1200,
          },
          "**960**": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": "",
            "value": 960,
          },
          "-$40": {
            "decimals": 0,
            "prefix": "$",
            "scaled": false,
            "suffix": "",
            "value": -40,
          },
          "-3": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": "",
            "value": -3,
          },
          "1-2": undefined,
          "12%": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": "%",
            "value": 12,
          },
          "4.5 kWh": {
            "decimals": 1,
            "prefix": "",
            "scaled": false,
            "suffix": " kWh",
            "value": 4.5,
          },
          "Q3": undefined,
          "about a third": undefined,
          "~40 hours": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": " hours",
            "value": 40,
          },
          "−3": {
            "decimals": 0,
            "prefix": "",
            "scaled": false,
            "suffix": "",
            "value": -3,
          },
        }
      `);
  });
});
