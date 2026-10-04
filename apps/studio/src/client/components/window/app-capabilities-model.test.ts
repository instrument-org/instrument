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
          },
        ],
        "finds": [
          {
            "detail": "List issues.",
            "label": "List issues",
            "name": "list_issues",
          },
        ],
      }
    `);
  });
});
