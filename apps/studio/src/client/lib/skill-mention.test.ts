import {
  extractSkillMentions,
  renderSkillMentionsAsText,
  skillMentionToken,
  splitSkillMention,
} from "@instrument-org/shared/skill-mention";
import { describe, expect, it } from "vitest";

describe("splitSkillMention", () => {
  it("separates mentions from the text around them", () => {
    const lines = [
      "Use [$release](skill:release) to ship",
      "[$release](skill:release)",
      "[$label](skill:different)",
      "Nothing to see here",
      "[$a](skill:a)[$b](skill:b)",
    ];
    expect(
      Object.fromEntries(lines.map((line) => [line, splitSkillMention(line)])),
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

describe("renderSkillMentionsAsText", () => {
  it("renders tokens as their slash form across lines", () => {
    expect(
      renderSkillMentionsAsText(
        "Use [$release](skill:release) to ship this.\nThen [$docx](skill:docx).",
      ),
    ).toMatchInlineSnapshot(`
      "Use /release to ship this.
      Then /docx."
    `);
  });

  it("leaves a link whose label and target disagree untouched", () => {
    expect(renderSkillMentionsAsText("[$label](skill:different)")).toBe(
      "[$label](skill:different)",
    );
  });
});

describe("extractSkillMentions", () => {
  it("collects distinct names in first-seen order", () => {
    expect(
      extractSkillMentions("[$b](skill:b) [$a](skill:a) [$b](skill:b)"),
    ).toEqual(["b", "a"]);
  });

  it("skips a link whose label and target disagree", () => {
    expect(
      extractSkillMentions("[$a](skill:a) [$label](skill:different)"),
    ).toEqual(["a"]);
  });
});

describe("skillMentionToken", () => {
  it("round-trips with the split", () => {
    expect(splitSkillMention(skillMentionToken("tdd"))).toEqual([
      { name: "tdd", type: "skill" },
    ]);
  });
});
