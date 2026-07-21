import { describe, expect, it } from "vitest";

import { skillTokensToDisplayText, splitSkillTokens } from "./skill-tokens";

describe("splitSkillTokens", () => {
  it("separates mentions from the text around them", () => {
    const lines = [
      "Use [$release](skill:release) to ship",
      "[$release](skill:release)",
      "[$label](skill:different)",
      "Nothing to see here",
      "[$a](skill:a)[$b](skill:b)",
    ];
    expect(
      Object.fromEntries(lines.map((line) => [line, splitSkillTokens(line)])),
    ).toMatchInlineSnapshot(`
      {
        "Nothing to see here": [
          {
            "text": "Nothing to see here",
            "type": "text",
          },
        ],
        "Use [$release](skill:release) to ship": [
          {
            "text": "Use ",
            "type": "text",
          },
          {
            "name": "release",
            "type": "skill",
          },
          {
            "text": " to ship",
            "type": "text",
          },
        ],
        "[$a](skill:a)[$b](skill:b)": [
          {
            "name": "a",
            "type": "skill",
          },
          {
            "name": "b",
            "type": "skill",
          },
        ],
        "[$label](skill:different)": [
          {
            "text": "[$label](skill:different)",
            "type": "text",
          },
        ],
        "[$release](skill:release)": [
          {
            "name": "release",
            "type": "skill",
          },
        ],
      }
    `);
  });
});

describe("skillTokensToDisplayText", () => {
  it("renders tokens as their slash form across lines", () => {
    expect(
      skillTokensToDisplayText(
        "Use [$release](skill:release) to ship this.\nThen [$docx](skill:docx).",
      ),
    ).toMatchInlineSnapshot(`
      "Use /release to ship this.
      Then /docx."
    `);
  });
});
