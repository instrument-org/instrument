import { describe, expect, it } from "vitest";

import { transcriptLandmarks } from "./transcript-outline";

describe("markdown landmarks", () => {
  it("outlines a transcript's turns and tool calls", () => {
    const markdown = [
      "# Session: Fix the modal",
      "",
      "## User (Turn 1) @ 2026-08-12T09:00:00.000Z",
      "",
      "Fix it please",
      "",
      "## Assistant (User Turn 1, Step 1) @ 2026-08-12T09:00:01.000Z +2.5s",
      "",
      "### Tool Call 1: bash",
      "",
      "### Tool Result 1: bash",
    ].join("\n");

    expect(transcriptLandmarks(markdown, "markdown")).toMatchInlineSnapshot(`
      [
        {
          "depth": 0,
          "label": "Session: Fix the modal",
          "line": 0,
        },
        {
          "depth": 1,
          "label": "User (Turn 1)",
          "line": 2,
        },
        {
          "depth": 1,
          "label": "Assistant (User Turn 1, Step 1)",
          "line": 6,
        },
        {
          "depth": 2,
          "label": "Tool Call 1: bash",
          "line": 8,
        },
        {
          "depth": 2,
          "label": "Tool Result 1: bash",
          "line": 10,
        },
      ]
    `);
  });

  // Tool output is fenced as markdown precisely because it often is markdown,
  // so a transcript of a session about documentation is full of `#` lines that
  // are content. Reading them as structure buries the real turns.
  it("ignores headings inside fenced tool output", () => {
    const markdown = [
      "## User (Turn 1)",
      "",
      "```markdown",
      "# Session: Not a real session",
      "## User (Turn 99)",
      "```",
      "",
      "## User (Turn 2)",
    ].join("\n");

    expect(transcriptLandmarks(markdown, "markdown").map((l) => l.label))
      .toMatchInlineSnapshot(`
        [
          "User (Turn 1)",
          "User (Turn 2)",
        ]
      `);
  });

  // A tool call's input is rendered as XML, not fenced, so a turn that writes a
  // markdown file puts that file's headings straight into the body. They are
  // the transcript's contents rather than its structure.
  it("ignores headings in an unfenced tool input", () => {
    const markdown = [
      "### Tool Call 4: write_file",
      "",
      "<write_file>",
      "<path>/task/SKILL.md</path>",
      "<content># Frowny",
      "",
      "## Usage",
      "</content>",
      "</write_file>",
      "",
      "## Assistant (User Turn 1, Step 5)",
    ].join("\n");

    expect(transcriptLandmarks(markdown, "markdown").map((l) => l.label))
      .toMatchInlineSnapshot(`
        [
          "Tool Call 4: write_file",
          "Assistant (User Turn 1, Step 5)",
        ]
      `);
  });

  // Fences lengthen to survive nesting, so a three-backtick run inside a
  // four-backtick block is content and must not close it.
  it("keeps a longer fence open past a shorter run inside it", () => {
    const markdown = [
      "## User (Turn 1)",
      "````markdown",
      "```",
      "## User (Turn 99)",
      "```",
      "````",
      "## User (Turn 2)",
    ].join("\n");

    expect(transcriptLandmarks(markdown, "markdown").map((l) => l.label))
      .toMatchInlineSnapshot(`
        [
          "User (Turn 1)",
          "User (Turn 2)",
        ]
      `);
  });
});

describe("json landmarks", () => {
  it("outlines one entry per message", () => {
    const json = JSON.stringify(
      {
        id: "ses_1",
        messages: [
          { parts: [{ text: "hi", type: "text" }], role: "user" },
          { parts: [{ type: "tool-bash" }], role: "assistant" },
        ],
      },
      null,
      2,
    );

    expect(transcriptLandmarks(json, "json")).toMatchInlineSnapshot(`
      [
        {
          "depth": 1,
          "label": "1. user",
          "line": 10,
        },
        {
          "depth": 1,
          "label": "2. assistant",
          "line": 18,
        },
      ]
    `);
  });
});
