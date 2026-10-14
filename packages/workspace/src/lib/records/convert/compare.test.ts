import { describe, expect, it } from "vitest";

import {
  addDifference,
  addDifferences,
  type Difference,
  MAX_DIFFERENCES,
} from "./compare";

function differences(old: unknown, now: unknown): Difference[] {
  const found: Difference[] = [];
  addDifferences(found, "x", old, now);
  return found;
}

const INSTANT = new Date("2026-10-14T12:00:00.000Z");

describe("addDifferences", () => {
  it.each([
    ["an undefined field and no field", { a: 1, b: undefined }, { a: 1 }],
    ["NaN and no field", { tokens: Number.NaN }, {}],
    ["Infinity and no field", { tokens: Infinity }, {}],
    ["two dates for one instant", INSTANT, new Date(INSTANT.getTime())],
    [
      "a date and its ISO string",
      { at: INSTANT },
      { at: INSTANT.toISOString() },
    ],
    ["nested arrays and objects", [{ a: [1, "b"] }], [{ a: [1, "b"] }]],
  ])("finds none between %s", (_, old, now) => {
    expect(differences(old, now)).toEqual([]);
  });

  it("names each field that differs, with what each side holds", () => {
    expect(
      differences(
        { at: INSTANT, list: [1, 2], name: "a", nested: { flag: true } },
        {
          at: "2026-10-14T12:00:01.000Z",
          list: [1],
          name: null,
          nested: { flag: false },
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "now": ""2026-10-14T12:00:01.000Z"",
          "old": "2026-10-14T12:00:00.000Z",
          "path": "x.at",
        },
        {
          "now": "1",
          "old": "2",
          "path": "x.list.length",
        },
        {
          "old": "2",
          "path": "x.list[1]",
        },
        {
          "now": "null",
          "old": ""a"",
          "path": "x.name",
        },
        {
          "now": "false",
          "old": "true",
          "path": "x.nested.flag",
        },
      ]
    `);
  });

  it("tells a Map from the empty object JSON makes of it", () => {
    expect(differences(new Map([["a", 1]]), {})).toMatchInlineSnapshot(`
      [
        {
          "old": "[["a",1]]",
          "path": "x.<Map>",
        },
      ]
    `);
  });

  it("stops at the most differences one chat reports", () => {
    const many = Array.from({ length: MAX_DIFFERENCES + 10 }, (_, n) => n);
    expect(
      differences(
        many,
        many.map((n) => n + 1),
      ),
    ).toHaveLength(MAX_DIFFERENCES);
  });

  it("leaves out the side that holds nothing", () => {
    const found: Difference[] = [];
    addDifference(found, "ses_1", undefined, "a session chat.db does not hold");
    addDifference(found, "ses_2", "a session", undefined);
    expect(found).toMatchInlineSnapshot(`
      [
        {
          "now": ""a session chat.db does not hold"",
          "path": "ses_1",
        },
        {
          "old": ""a session"",
          "path": "ses_2",
        },
      ]
    `);
  });
});
