import { describe, expect, it } from "vitest";

import { capabilitiesOf, firstSentence } from "./app-capabilities-model";

describe("firstSentence", () => {
  it.each([
    [
      "List issues in the workspace. Supports filters.",
      "List issues in the workspace.",
    ],
    ["## Search\n\nFind **pages** by `title`", "Search"],
    ["Get v1.2 of a doc. Then more.", "Get v1.2 of a doc."],
    ["", undefined],
    [`${"word ".repeat(40)}end.`, `${"word ".repeat(28).trimEnd()}…`],
  ])("%j", (text, expected) => {
    expect(firstSentence(text)).toBe(expected);
  });
});

describe("capabilitiesOf", () => {
  // Try opens the action and runs it as it stands, which only a look-up
  // asking for nothing can do; one that needs input offers only Ask.
  it.each([
    [[], true],
    [[{ name: "limit", required: false }], true],
    [[{ name: "query", required: true }], false],
  ])("offers a try on a look-up taking %j: %s", (params, runsAsIs) => {
    expect(
      capabilitiesOf([
        { description: "Search.", isRead: true, name: "search", params },
      ]).finds[0]?.runsAsIs,
    ).toBe(runsAsIs);
  });

  it("splits reads from changes and names each in words", () => {
    expect(
      capabilitiesOf([
        {
          description: "List issues. Paged.",
          isRead: true,
          name: "list_issues",
          params: [],
        },
        {
          description: "Create an issue.",
          isRead: false,
          name: "save_issue",
          params: [],
          title: "Create or update issue",
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "does": [
          {
            "detail": "Create an issue.",
            "label": "Create or update issue",
            "name": "save_issue",
            "runsAsIs": false,
          },
        ],
        "finds": [
          {
            "detail": "List issues.",
            "label": "List issues",
            "name": "list_issues",
            "runsAsIs": true,
          },
        ],
      }
    `);
  });
});
