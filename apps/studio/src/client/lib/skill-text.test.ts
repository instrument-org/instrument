import { describe, expect, it } from "vitest";

import { splitSkillText } from "./skill-text";

describe("splitSkillText", () => {
  it("separates composer tokens, bare slash commands and the text around them", () => {
    const lines = [
      "Use /release to ship",
      "Use [$release](skill:release) to ship",
      "/release",
      "Read use /release. Then /docx, maybe.",
      "Look in src/lib and at https://example.com/skills",
      "/a /b",
      "Nothing to see here",
    ];
    expect(
      Object.fromEntries(lines.map((line) => [line, splitSkillText(line)])),
    ).toMatchInlineSnapshot(`
      {
        "/a /b": [
          {
            "name": "a",
            "type": "slash",
          },
          {
            "text": " ",
            "type": "text",
          },
          {
            "name": "b",
            "type": "slash",
          },
        ],
        "/release": [
          {
            "name": "release",
            "type": "slash",
          },
        ],
        "Look in src/lib and at https://example.com/skills": [
          {
            "text": "Look in src/lib and at https://example.com/skills",
            "type": "text",
          },
        ],
        "Nothing to see here": [
          {
            "text": "Nothing to see here",
            "type": "text",
          },
        ],
        "Read use /release. Then /docx, maybe.": [
          {
            "text": "Read use ",
            "type": "text",
          },
          {
            "name": "release",
            "type": "slash",
          },
          {
            "text": ". Then ",
            "type": "text",
          },
          {
            "name": "docx",
            "type": "slash",
          },
          {
            "text": ", maybe.",
            "type": "text",
          },
        ],
        "Use /release to ship": [
          {
            "text": "Use ",
            "type": "text",
          },
          {
            "name": "release",
            "type": "slash",
          },
          {
            "text": " to ship",
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
      }
    `);
  });
});
