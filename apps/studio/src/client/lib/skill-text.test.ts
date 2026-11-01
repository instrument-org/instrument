import { describe, expect, it } from "vitest";

import { splitMessageText, splitSkillText } from "./skill-text";

describe("splitSkillText", () => {
  it("separates composer tokens, bare slash commands and the text around them", () => {
    const lines = [
      "Use /release to ship",
      "Use /workspace:release to ship",
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
        "Use /workspace:release to ship": [
          {
            "text": "Use ",
            "type": "text",
          },
          {
            "name": "workspace:release",
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

describe("splitMessageText", () => {
  it("takes links before paths and paths before slash commands", () => {
    const shape = (line: string) =>
      splitMessageText(line, "darwin").map((segment) =>
        segment.type === "path"
          ? `path:${segment.text}`
          : segment.type === "link"
            ? `link:${segment.href}`
            : segment.type === "slash"
              ? `slash:${segment.name}`
              : segment.type === "text"
                ? segment.text
                : segment.type,
      );
    expect(
      [
        "Read /Users/casey/notes.md then /release",
        "See https://example.com/Users/casey/a.md",
        "[$release](skill:release) ~/Desktop/plan.pdf",
      ].map(shape),
    ).toMatchInlineSnapshot(`
      [
        [
          "Read ",
          "path:/Users/casey/notes.md",
          " then ",
          "slash:release",
        ],
        [
          "See ",
          "link:https://example.com/Users/casey/a.md",
        ],
        [
          "skill",
          " ",
          "path:~/Desktop/plan.pdf",
        ],
      ]
    `);
  });
});
